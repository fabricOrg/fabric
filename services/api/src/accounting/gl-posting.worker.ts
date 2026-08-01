import { sql } from "drizzle-orm";
import {
  type GlDb,
  insertJournal,
  loadChartOfAccounts,
  PermanentPostingError,
  type RequestRow,
  toPostingSpec,
} from "./gl-journal-writer.js";

/**
 * THE GL POSTING DRAIN (ADR-0013 #10, slice 1b) — the other side of the airlock.
 *
 * Runs as `app_provisioner`, the only role that may write the company's books. It reads
 * `gl_posting_requests` (which the tenant path can insert into and nothing more), maps each payload
 * through the pure posting policy, and writes the journal. Journal construction itself lives in
 * gl-journal-writer.ts; this file is the loop and the failure policy.
 *
 * EXACTLY-ONCE COMES FROM THE KEY, NOT FROM DELIVERY. Every journal is keyed
 * `ledger_txn:{ledger_txn_id}` and that key is globally UNIQUE, so a crash between posting the journal
 * and marking the request is harmless: the next drain sees the journal already exists and just finishes
 * the bookkeeping. That is a recovery path, not an error path.
 *
 * NO ADVISORY LOCK, unlike the other maintenance jobs: each request is claimed with
 * `FOR UPDATE SKIP LOCKED`, so several workers drain the same queue safely and none of them blocks.
 */

/** Attempts before a request is parked as `failed` for a human to look at. */
const MAX_ATTEMPTS = 5;

export interface GlDrainResult {
  /** Rows this call locked and processed. */
  claimed: number;
  posted: number;
  /** Requests whose journal already existed — a previous attempt's bookkeeping, now finished. */
  recovered: number;
  /** Parked as permanently unpostable. */
  failed: number;
  /**
   * Hit a transient fault and left pending for the next tick. Reported separately from `failed`
   * because a drain that quietly retries forever is the worst outcome here: the books stay incomplete
   * and every other counter still reads zero. A silent retry is a defect, not a non-event.
   */
  retrying: number;
  /** The most recent error text, so a caller can log WHY without querying the queue. */
  lastError?: string;
}

/**
 * Post one claimed request. A request another worker already holds is skipped rather than waited on.
 */
async function postOne(
  db: GlDb,
  requestId: string,
  chart: Map<string, string>,
): Promise<"posted" | "recovered" | "skipped"> {
  return await db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, tenant_id, ledger_txn_id, currency, event_time, channel, legs
      FROM gl_posting_requests
      WHERE id = ${requestId} AND status = 'pending'
      FOR UPDATE SKIP LOCKED
    `)) as unknown as RequestRow[];
    const row = rows[0];
    if (!row) return "skipped";

    const spec = toPostingSpec(row);

    /**
     * RECOVERY IS A LOOKUP, NOT AN ERROR PATH. Ask first whether this journal is already in the books —
     * the state a crash between the journal insert and the bookkeeping update leaves behind. Handling
     * it deterministically beats pattern-matching a driver's error shape, since drizzle wraps the
     * postgres.js error and `constraint_name` is not reliably where you expect it. `insertJournal`
     * still treats a unique violation as "already posted", as a backstop for the narrow race between
     * this check and the insert.
     */
    const already = (await tx.execute(sql`
      SELECT id FROM gl_journals WHERE idempotency_key = ${spec.idempotency_key}
    `)) as unknown as Array<{ id: string }>;
    const existingId = already[0]?.id;

    const journalId = existingId ?? (await insertJournal(tx, spec, chart));

    if (journalId === null) {
      // The backstop fired: another worker inserted it between the check and our insert.
      const raced = (await tx.execute(sql`
        SELECT id FROM gl_journals WHERE idempotency_key = ${spec.idempotency_key}
      `)) as unknown as Array<{ id: string }>;
      await markPosted(tx, requestId, raced[0]?.id ?? null);
      return "recovered";
    }

    await markPosted(tx, requestId, journalId);
    return existingId ? "recovered" : "posted";
  });
}

/**
 * `attempts` is NOT incremented here. It counts FAILED tries, so an operator triaging the queue can
 * tell "posted first time" from "posted after a transient fault", and so a future "attempts > 0" alert
 * means something.
 */
async function markPosted(
  tx: Parameters<Parameters<GlDb["transaction"]>[0]>[0],
  requestId: string,
  journalId: string | null,
): Promise<void> {
  await tx.execute(sql`
    UPDATE gl_posting_requests
    SET status = 'posted', posted_journal_id = ${journalId}, updated_at = now()
    WHERE id = ${requestId}
  `);
}

/**
 * Record a failure OUTSIDE the failed transaction — that one rolled back, so any update inside it went
 * with it. A permanently unpostable payload is parked immediately; a transient fault stays pending and
 * retries on the next tick until MAX_ATTEMPTS, so a database blip does not park real money postings.
 */
async function recordFailure(
  db: GlDb,
  requestId: string,
  error: unknown,
): Promise<"failed" | "retrying"> {
  const permanent = error instanceof PermanentPostingError;
  const message = error instanceof Error ? error.message : "unknown error";
  // The status = 'pending' guard below is load-bearing: this runs AFTER the failed transaction rolled
  // back, so another worker may have posted the request in the meantime. Without it, a connection lost
  // at COMMIT would let this rewrite a 'posted' row back to 'pending' — or to 'failed' while
  // posted_journal_id still points at a real journal, a self-contradictory reconciliation link.
  const rows = (await db.execute(sql`
    UPDATE gl_posting_requests
    SET attempts = attempts + 1,
        last_error = ${message.slice(0, 500)},
        status = CASE
          WHEN ${permanent} OR attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed'::gl_posting_status
          ELSE 'pending'::gl_posting_status
        END,
        updated_at = now()
    WHERE id = ${requestId} AND status = 'pending'
    RETURNING status
  `)) as unknown as Array<{ status: string }>;
  // No row updated means someone else resolved it; that is not a failure of ours to report.
  if (rows.length === 0) return "retrying";
  return rows[0]?.status === "failed" ? "failed" : "retrying";
}

/**
 * Drain up to `limit` pending posting requests. Safe to run concurrently and safe to re-run: the
 * journal's idempotency key, not this function, is what makes posting exactly-once.
 */
export async function drainGlPostingRequests(
  db: GlDb,
  limit = 200,
): Promise<GlDrainResult> {
  const result: GlDrainResult = {
    claimed: 0,
    posted: 0,
    recovered: 0,
    failed: 0,
    retrying: 0,
  };

  const pending = (await db.execute(sql`
    SELECT id FROM gl_posting_requests
    WHERE status = 'pending'
    ORDER BY created_at
    LIMIT ${limit}
  `)) as unknown as Array<{ id: string }>;
  if (pending.length === 0) return result;

  const chart = await loadChartOfAccounts(db);

  for (const { id } of pending) {
    try {
      const outcome = await postOne(db, id, chart);
      if (outcome === "skipped") continue;
      result.claimed += 1;
      if (outcome === "posted") result.posted += 1;
      else result.recovered += 1;
    } catch (error) {
      result.claimed += 1;
      result.lastError =
        error instanceof Error ? error.message : "unknown error";
      if ((await recordFailure(db, id, error)) === "failed") result.failed += 1;
      else result.retrying += 1;
    }
  }

  return result;
}
