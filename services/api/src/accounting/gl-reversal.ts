import type { MinorUnits, TenantId } from "@app/db";
import { glJournalLines, glJournals } from "@app/db";
import { accountingDateFromEventTime } from "@app/domain";
import { sql } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";
import { type GlDb, isUniqueViolation } from "./gl-journal-writer.js";

/**
 * REVERSING A POSTED JOURNAL (ADR-0013 #9) — the only way to correct the company's books.
 *
 * Posted history is immutable by trigger, for every role including the owner, so there is no edit and
 * no delete. A correction is a new journal with the same accounts and amounts and every direction
 * flipped, so the pair nets to zero and both entries remain visible to an auditor.
 *
 * IT REVERSES THE POSTED LINES, NOT A RE-DERIVED SPEC. Re-deriving from the original movement would
 * reverse whatever the CURRENT posting policy produces, and if the kind→account mapping changed between
 * posting and reversing, that credits an account the original never touched. The pair would still net
 * to zero, so no invariant would fire, while two control accounts silently went wrong. Reading the rows
 * back is what makes a reversal actually reverse.
 */

export interface GlReversalResult {
  reversalJournalId: string;
  /** True when this journal had already been reversed, so nothing further was posted. */
  alreadyReversed: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PostedLine {
  account_id: string;
  direction: "debit" | "credit";
  amount_minor: string;
  tenant_id: string | null;
  channel: string | null;
}

/**
 * Reverse `journalId`. Idempotent: the database's UNIQUE on `reverses_journal_id` means a journal can
 * be reversed at most once, so a retried correction returns the existing reversal instead of
 * overstating the books in the opposite direction.
 *
 * `eventTime` is the reversal's OWN time, not the original's — a correction happens when it happens.
 * Back-dating one into a closed period is a decision for Phase 8's close controls, not a default here.
 */
export async function reverseGlJournal(
  db: GlDb,
  args: {
    journalId: string;
    memo: string;
    /** The staff actor. Recorded in the journal's metadata — a correction needs a who, not just a why. */
    requestedBy: string;
    eventTime?: Date;
  },
): Promise<GlReversalResult> {
  if (!UUID_PATTERN.test(args.journalId)) {
    // Otherwise the first query fails with a raw 22P02 from Postgres, before the existence check.
    throw invalidRequest(
      "gl_journal_id_invalid",
      "journalId must be a uuid.",
      "journalId",
    );
  }
  return await db.transaction(async (tx) => {
    const existing = (await tx.execute(sql`
      SELECT id FROM gl_journals WHERE reverses_journal_id = ${args.journalId}
    `)) as unknown as Array<{ id: string }>;
    const alreadyId = existing[0]?.id;
    if (alreadyId) {
      return { reversalJournalId: alreadyId, alreadyReversed: true };
    }

    const originals = (await tx.execute(sql`
      SELECT j.currency, j.source_kind, j.line_count
      FROM gl_journals j WHERE j.id = ${args.journalId}
    `)) as unknown as Array<{
      currency: string;
      source_kind: string;
      line_count: number;
    }>;
    const original = originals[0];
    if (!original) {
      throw notFound(
        "gl_journal_not_found",
        `General ledger journal ${args.journalId} does not exist.`,
      );
    }
    if (original.source_kind === "reversal") {
      // Reversing a reversal is legitimate accounting, but it must be a deliberate call rather than a
      // side effect of a retry loop walking a chain — so require the caller to mean it explicitly.
      throw invalidRequest(
        "gl_journal_already_a_reversal",
        `Journal ${args.journalId} is itself a reversal; reverse the original instead.`,
      );
    }

    const lines = (await tx.execute(sql`
      SELECT account_id, direction::text AS direction, amount_minor::text AS amount_minor,
             tenant_id, channel
      FROM gl_journal_lines WHERE journal_id = ${args.journalId}
    `)) as unknown as PostedLine[];
    /**
     * Compare against the journal's DECLARED count, not just `>= 2`. A journal holding fewer lines than
     * it declared is already a violation of GL invariant 2 (history tampered with), and reversing what
     * remains would produce a self-consistent journal that does not actually reverse the original — with
     * no invariant firing on the pair. Refuse rather than paper over it.
     */
    if (lines.length !== Number(original.line_count)) {
      throw invalidRequest(
        "gl_journal_incomplete",
        `Journal ${args.journalId} holds ${lines.length} line(s) but declares ${original.line_count}; it cannot be reversed until that is explained.`,
      );
    }

    const eventTime = args.eventTime ?? new Date();
    let inserted: Array<{ id: string }>;
    try {
      inserted = await tx
        .insert(glJournals)
        .values({
          idempotencyKey: `reversal:${args.journalId}`,
          sourceKind: "reversal",
          sourceRef: args.journalId,
          currency: original.currency,
          lineCount: lines.length,
          eventTime,
          accountingDate: accountingDateFromEventTime(eventTime.toISOString()),
          memo: args.memo,
          // Who asked for this, alongside what and when. `memo` is prose; an auditor needs the actor.
          metadata: { requested_by: args.requestedBy },
          reversesJournalId: args.journalId,
        })
        .returning({ id: glJournals.id });
    } catch (error) {
      /**
       * The existence check above is a read-modify-write, so two concurrent reversals can both pass it
       * and both insert. The database settles it — UNIQUE on `reverses_journal_id` and on the
       * `reversal:{id}` key — and the loser must return the winner's reversal rather than propagate a
       * raw constraint error to an operator who double-clicked.
       */
      if (
        isUniqueViolation(error, "uniq_gl_journal_reverses") ||
        isUniqueViolation(error, "uniq_gl_journal_idempotency")
      ) {
        const winner = (await tx.execute(sql`
          SELECT id FROM gl_journals WHERE reverses_journal_id = ${args.journalId}
        `)) as unknown as Array<{ id: string }>;
        const winnerId = winner[0]?.id;
        if (winnerId) {
          return { reversalJournalId: winnerId, alreadyReversed: true };
        }
      }
      throw error;
    }

    const reversalId = inserted[0]?.id;
    if (!reversalId) throw new Error("reversal journal insert returned no id");

    await tx.insert(glJournalLines).values(
      lines.map((line) => ({
        journalId: reversalId,
        accountId: line.account_id,
        // The flip, and the only thing that differs from the original.
        direction:
          line.direction === "credit"
            ? ("debit" as const)
            : ("credit" as const),
        amountMinor: BigInt(line.amount_minor) as MinorUnits,
        ...(line.tenant_id ? { tenantId: line.tenant_id as TenantId } : {}),
        ...(line.channel ? { channel: line.channel } : {}),
      })),
    );

    return { reversalJournalId: reversalId, alreadyReversed: false };
  });
}
