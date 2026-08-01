import { subledgerPostingEventSchema } from "@app/contracts";
import { correctionKey, deriveJournalFromSubledgerEvent } from "@app/domain";
import { sql } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";
import {
  type GlDb,
  insertJournal,
  loadChartOfAccounts,
} from "./gl-journal-writer.js";
import { reverseGlJournalInTx } from "./gl-reversal.js";

/**
 * CORRECTING A MIS-POSTED MIRROR JOURNAL (ADR-0013 #11a).
 *
 * Reversal alone cannot fix a mis-posting. It un-posts the wrong amount, but the movement is still in
 * the subledger with nothing correctly mirroring it — so the ledgers still disagree, and the
 * reconciliation still reports it. A correction is therefore two postings, not one: reverse the bad
 * journal, then re-post the movement under a correction key.
 *
 * ATOMIC, deliberately. Both halves run in ONE transaction, so the books are never observably in the
 * reversed-but-uncorrected state — otherwise the hourly reconciliation could fire on a discrepancy
 * somebody is midway through fixing.
 *
 * THE CORRECTED LINES COME FROM THE LIVE SUBLEDGER LEGS, not from the queued payload. This inverts the
 * airlock's usual stance on purpose (ADR-0013 #10): the payload is EVIDENCE of what the drain saw, which
 * makes it precisely the thing to distrust when the posting turned out wrong. The subledger is the
 * source of truth for what the movement was, and `app_provisioner` can read it cross-tenant through the
 * `provisioner_read` policies from migration 0027.
 */

export interface GlCorrectionResult {
  reversalJournalId: string;
  correctionJournalId: string;
  /** Which correction this was: 2 for the first, 3 for the next, and so on. */
  correctionSequence: number;
}

/** How many corrections one movement may accumulate before a human has to look instead. */
const MAX_CORRECTIONS = 9;

interface MovementRow {
  tenant_id: string;
  currency: string;
  event_time: string | Date;
  legs: unknown;
}

/**
 * Correct the mirror journal `journalId`.
 *
 * Idempotency rests where it always does — on the database. A journal can be reversed at most once
 * (UNIQUE on `reverses_journal_id`), so a retried correction reverses nothing further; and the
 * correction key is UNIQUE, so a retry either re-posts under the next free sequence or collides. The
 * sequence is therefore derived from what is already posted rather than passed in by a caller.
 */
export async function correctGlPosting(
  db: GlDb,
  args: { journalId: string; reason: string; requestedBy: string },
): Promise<GlCorrectionResult> {
  const chart = await loadChartOfAccounts(db);

  return await db.transaction(async (tx) => {
    const journals = (await tx.execute(sql`
      SELECT source_kind::text AS source_kind, source_ref
      FROM gl_journals WHERE id = ${args.journalId}
    `)) as unknown as Array<{ source_kind: string; source_ref: string }>;
    const journal = journals[0];
    if (!journal) {
      throw notFound(
        "gl_journal_not_found",
        `General ledger journal ${args.journalId} does not exist.`,
      );
    }
    if (journal.source_kind !== "ledger_txn") {
      // Only a MIRROR can be corrected this way, because only a mirror has a subledger movement to
      // re-derive from. A manual adjustment or a reversal is corrected by its own reversal.
      throw invalidRequest(
        "gl_journal_not_a_mirror",
        `Journal ${args.journalId} has source_kind '${journal.source_kind}'; only a mirrored movement can be re-posted from the subledger.`,
      );
    }

    // Reverse first, in this transaction, so the two postings land together or not at all.
    const reversal = await reverseGlJournalInTx(tx, {
      journalId: args.journalId,
      memo: `corrected: ${args.reason}`,
      requestedBy: args.requestedBy,
    });

    /**
     * A reversal already existed, so this journal has already been superseded — and re-posting the
     * movement again would DOUBLE the books: the original is reversed, the earlier correction stands,
     * and a second correction adds the amount a third time. Refuse and say where to go instead.
     *
     * Correcting a correction is legitimate; it just means passing THAT journal's id, since it is a
     * mirror too and gets its own reversal and its own next sequence.
     */
    if (reversal.alreadyReversed) {
      throw invalidRequest(
        "gl_journal_already_corrected",
        `Journal ${args.journalId} was already reversed by ${reversal.reversalJournalId}; correct the journal that superseded it, not this one.`,
      );
    }

    // Re-read the movement from the subledger. This is the step that makes it a CORRECTION rather than
    // a second guess at the same payload.
    const movements = (await tx.execute(sql`
      SELECT lt.tenant_id::text AS tenant_id,
             min(la.currency)   AS currency,
             lt.created_at      AS event_time,
             jsonb_agg(
               jsonb_build_object(
                 'account_kind', la.kind::text,
                 'direction', le.direction::text,
                 'amount_minor', le.amount_minor::text
               ) ORDER BY le.id
             )                  AS legs
      FROM ledger_transactions lt
      JOIN ledger_entries le ON le.txn_id = lt.id
      JOIN ledger_accounts la ON la.id = le.account_id
      WHERE lt.id = ${journal.source_ref}::uuid
      GROUP BY lt.id, lt.tenant_id, lt.created_at
    `)) as unknown as MovementRow[];
    const movement = movements[0];
    if (!movement) {
      // The movement is gone or invisible. Re-posting a guess here would be fabricating an entry.
      throw invalidRequest(
        "gl_movement_unreadable",
        `Subledger movement ${journal.source_ref} has no readable legs; the correction cannot be derived from it.`,
      );
    }

    const eventTime =
      movement.event_time instanceof Date
        ? movement.event_time
        : new Date(String(movement.event_time));
    const parsed = subledgerPostingEventSchema.safeParse({
      ledger_txn_id: journal.source_ref,
      currency: movement.currency,
      event_time: eventTime.toISOString(),
      tenant_id: movement.tenant_id,
      legs: movement.legs,
    });
    if (!parsed.success) {
      throw invalidRequest(
        "gl_movement_invalid",
        `Subledger movement ${journal.source_ref} does not satisfy the posting contract: ${parsed.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      );
    }

    const sequence = await nextCorrectionSequence(tx, journal.source_ref);
    const spec = deriveJournalFromSubledgerEvent(parsed.data, {
      correctionSequence: sequence,
    });
    const correctionJournalId = await insertJournal(
      tx,
      { ...spec, memo: `correction #${sequence}: ${args.reason}` },
      chart,
    );
    if (correctionJournalId === null) {
      // The key already exists, so this correction was already posted by a concurrent caller.
      throw invalidRequest(
        "gl_correction_already_posted",
        `Correction ${sequence} for movement ${journal.source_ref} already exists.`,
      );
    }

    return {
      reversalJournalId: reversal.reversalJournalId,
      correctionJournalId,
      correctionSequence: sequence,
    };
  });
}

/**
 * The next free correction sequence for a movement, counted from what is posted. Starts at 2 because
 * the original mirror owns the unsuffixed key.
 */
async function nextCorrectionSequence(
  tx: Parameters<Parameters<GlDb["transaction"]>[0]>[0],
  ledgerTxnId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT count(*)::int AS posted
    FROM gl_journals
    WHERE source_kind = 'ledger_txn' AND source_ref = ${ledgerTxnId}
  `)) as unknown as Array<{ posted: number }>;
  // One existing journal (the original) means the next correction is #2.
  const sequence = Number(rows[0]?.posted ?? 1) + 1;
  if (sequence > MAX_CORRECTIONS) {
    throw invalidRequest(
      "gl_correction_limit_reached",
      `Movement ${ledgerTxnId} has been corrected ${sequence - 2} times; stop and investigate rather than posting another.`,
    );
  }
  // Proves the format is legal before the insert relies on it.
  correctionKey(ledgerTxnId, sequence);
  return sequence;
}
