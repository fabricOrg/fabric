import {
  type GlJournalSpec,
  subledgerPostingEventSchema,
} from "@app/contracts";
import {
  glJournalLines,
  glJournals,
  type MinorUnits,
  type ProvisioningDb,
  type TenantId,
} from "@app/db";
import { deriveJournalFromSubledgerEvent } from "@app/domain";
import { sql } from "drizzle-orm";

/**
 * Turning one queued posting request into a corporate journal (ADR-0013 slice 1b). Split from the drain
 * loop so that file stays about scheduling and this one about correctness.
 */

/** The drizzle handle inside the provisioning wrapper — `ProvisioningDb` is `{ db, end }`. */
export type GlDb = ProvisioningDb["db"];
export type GlTx = Parameters<Parameters<GlDb["transaction"]>[0]>[0];

/** A payload the posting policy can never accept. Retrying it forever would be pointless. */
export class PermanentPostingError extends Error {}

export interface RequestRow {
  id: string;
  tenant_id: string;
  ledger_txn_id: string;
  currency: string;
  /**
   * A raw `execute()` hands timestamptz back as a STRING, not a Date — unlike a typed drizzle select.
   * Typed as both so the coercion below is forced rather than assumed; assuming Date here silently
   * turned every drain into a permanent retry loop once, visible only in `last_error`.
   */
  event_time: string | Date;
  channel: string | null;
  legs: unknown;
}

/**
 * The chart of accounts, code -> id. Loaded once per drain: it is seeded reference data that only a
 * migration changes, so re-reading it per request would be waste.
 */
export async function loadChartOfAccounts(
  db: GlDb,
): Promise<Map<string, string>> {
  const rows = (await db.execute(
    sql`SELECT id, code FROM gl_accounts`,
  )) as unknown as Array<{ id: string; code: string }>;
  return new Map(rows.map((r) => [r.code, r.id]));
}

/** Turn a queued row into the journal spec, failing loudly if the payload is not what it claims. */
export function toPostingSpec(row: RequestRow): GlJournalSpec {
  const eventTime =
    row.event_time instanceof Date
      ? row.event_time
      : new Date(String(row.event_time));
  if (Number.isNaN(eventTime.getTime())) {
    throw new PermanentPostingError(
      `event_time is not a valid timestamp: ${String(row.event_time)}`,
    );
  }
  const parsed = subledgerPostingEventSchema.safeParse({
    ledger_txn_id: row.ledger_txn_id,
    currency: row.currency,
    event_time: eventTime.toISOString(),
    tenant_id: row.tenant_id,
    ...(row.channel ? { channel: row.channel } : {}),
    legs: row.legs,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")} ${i.message}`)
      .join("; ");
    /**
     * An unknown `account_kind` is DEPLOY SKEW, not a malformed payload: a value added to the
     * `ledger_account_kind` pgEnum reaches the database before an image carrying the widened zod enum
     * reaches the API. Retry — it resolves itself. Anything else about the payload (a bad amount, a bad
     * uuid) is genuinely unpostable and is parked.
     */
    const enumDrift = parsed.error.issues.some((i) =>
      i.path.includes("account_kind"),
    );
    const message = `payload does not satisfy the posting contract: ${detail}`;
    throw enumDrift
      ? new Error(`${message} — image may lag the ledger_account_kind enum`)
      : new PermanentPostingError(message);
  }
  try {
    return deriveJournalFromSubledgerEvent(parsed.data);
  } catch (error) {
    // A RangeError here means the movement did not balance — the posting policy refusing to mirror it.
    throw new PermanentPostingError(
      error instanceof Error ? error.message : "posting derivation failed",
    );
  }
}

/** Shared with the reversal service, which settles its own races on the same constraint machinery. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    code?: unknown;
    constraint_name?: unknown;
    cause?: unknown;
  };
  if (e.code === "23505" && String(e.constraint_name) === constraint) {
    return true;
  }
  // drizzle wraps the postgres.js error, so the useful fields sit on `cause`.
  return e.cause ? isUniqueViolation(e.cause, constraint) : false;
}

/**
 * Insert the journal and its lines. Returns null when the journal already exists — the narrow race
 * where another worker inserted it between the caller's existence check and this insert.
 */
export async function insertJournal(
  tx: GlTx,
  spec: GlJournalSpec,
  chart: Map<string, string>,
): Promise<string | null> {
  const lines = spec.lines.map((line) => {
    const accountId = chart.get(line.account_code);
    if (!accountId) {
      /**
       * TRANSIENT, not permanent — deliberately. A missing chart row is DEPLOY SKEW, not a bad
       * payload: this repo builds one image and promotes it, with migrations running as a separate
       * pre-deploy task, so an image that is briefly ahead of its migrations is a NORMAL state. Parking
       * these would strand every movement of a new account kind until someone ran SQL by hand. A plain
       * Error retries, and the movement posts once the migration lands.
       */
      throw new Error(
        `chart of accounts has no account with code ${line.account_code} — migrations may lag this image`,
      );
    }
    return { line, accountId };
  });

  try {
    const inserted = await tx
      .insert(glJournals)
      .values({
        idempotencyKey: spec.idempotency_key,
        sourceKind: spec.source_kind,
        sourceRef: spec.source_ref,
        currency: spec.currency,
        // The journal declares its own size so it becomes a closed set (ADR-0013 #8).
        lineCount: spec.lines.length,
        eventTime: new Date(spec.event_time),
        accountingDate: spec.accounting_date,
        ...(spec.memo ? { memo: spec.memo } : {}),
      })
      .returning({ id: glJournals.id });

    const journalId = inserted[0]?.id;
    if (!journalId) throw new Error("journal insert returned no id");

    await tx.insert(glJournalLines).values(
      lines.map(({ line, accountId }) => ({
        journalId,
        accountId,
        direction: line.direction,
        // Validated by the contract as a canonical positive integer within bigint range, so the brand
        // cast is sound rather than a way around the compiler.
        amountMinor: BigInt(line.amount_minor) as MinorUnits,
        ...(line.tenant_id ? { tenantId: line.tenant_id as TenantId } : {}),
        ...(line.channel ? { channel: line.channel } : {}),
      })),
    );
    return journalId;
  } catch (error) {
    if (isUniqueViolation(error, "uniq_gl_journal_idempotency")) return null;
    throw error;
  }
}
