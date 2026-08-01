import { randomUUID } from "node:crypto";
import {
  checkGlInvariants,
  createAppDb,
  createProvisioningDb,
  formatGlViolations,
} from "@app/db";
import { commit, credit, refund, reserve } from "@app/wallet";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainGlPostingRequests } from "./gl-posting.worker.js";

/**
 * End-to-end gate for the GL posting airlock (ADR-0013 slice 1b): a real wallet movement through the
 * RLS runtime seam must arrive in the company's books as a balanced journal, exactly once.
 *
 * Nothing here is mocked. The primitives run as `app_runtime` inside `withTenant`, the deferred trigger
 * enqueues, and the drain runs as `app_provisioner` — the same three roles as production.
 */

const SUPER_URL =
  process.env.DATABASE_URL_SUPER ?? process.env.DATABASE_URL_OWNER;
const APP_URL = process.env.DATABASE_URL_APP;
const PROV_URL = process.env.DATABASE_URL_PROVISIONER;
if (!SUPER_URL || !APP_URL || !PROV_URL) {
  throw new Error(
    "gl posting gate requires DATABASE_URL_SUPER + DATABASE_URL_APP + DATABASE_URL_PROVISIONER",
  );
}

const owner = postgres(SUPER_URL, { max: 2, onnotice: () => {} });
const app = createAppDb(APP_URL, { max: 3 });
const provisioning = createProvisioningDb(PROV_URL);

const TENANT = randomUUID();
const CCY = "GHS";
type Row = Record<string, unknown>;

const executor = {
  query: async (q: string) => ({
    rows: (await owner.unsafe(q)) as unknown as Row[],
  }),
};

/**
 * The journal a subledger transaction became, reported as its debit and credit account CODES rather
 * than a positional list — the assertion should say which side each account is on, not depend on the
 * order rows happen to come back in.
 */
async function journalFor(ledgerTxnId: string): Promise<{
  lineCount: number;
  currency: string;
  debit: string;
  credit: string;
  tenantIds: (string | null)[];
} | null> {
  const rows = (await owner`
    SELECT j.line_count, j.currency, l.direction, a.code, l.tenant_id
    FROM gl_journals j
    JOIN gl_journal_lines l ON l.journal_id = j.id
    JOIN gl_accounts a ON a.id = l.account_id
    WHERE j.idempotency_key = ${`ledger_txn:${ledgerTxnId}`}
    ORDER BY a.code`) as Row[];
  if (rows.length === 0) return null;
  const side = (d: string) =>
    String(rows.find((r) => String(r.direction) === d)?.code ?? "");
  return {
    lineCount: Number(rows[0]?.line_count),
    currency: String(rows[0]?.currency),
    debit: side("debit"),
    credit: side("credit"),
    tenantIds: rows.map((r) => (r.tenant_id ? String(r.tenant_id) : null)),
  };
}

async function requestStatus(ledgerTxnId: string): Promise<{
  status: string;
  attempts: number;
  journal: string | null;
} | null> {
  const rows = (await owner`
    SELECT status, attempts, posted_journal_id FROM gl_posting_requests
    WHERE ledger_txn_id = ${ledgerTxnId}`) as Row[];
  const r = rows[0];
  if (!r) return null;
  return {
    status: String(r.status),
    attempts: Number(r.attempts),
    journal: r.posted_journal_id ? String(r.posted_journal_id) : null,
  };
}

const msgId = () => randomUUID();

/** How many journals exist for a subledger transaction — the exactly-once assertion. */
async function journalCount(ledgerTxnId: string): Promise<number> {
  const rows = (await owner`
    SELECT count(*)::int AS count FROM gl_journals
    WHERE idempotency_key = ${`ledger_txn:${ledgerTxnId}`}`) as Row[];
  return Number(rows[0]?.count);
}

/** How many posting requests exist for a subledger transaction. */
async function requestCount(ledgerTxnId: string): Promise<number> {
  const rows = (await owner`
    SELECT count(*)::int AS count FROM gl_posting_requests
    WHERE ledger_txn_id = ${ledgerTxnId}`) as Row[];
  return Number(rows[0]?.count);
}

describe("GL posting airlock, end to end", () => {
  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug, plan)
      VALUES (${TENANT}, ${`gl-post-${TENANT}`}, ${`gl-post-${TENANT.slice(0, 8)}`}, 'sandbox')`;
  });

  afterAll(async () => {
    // Ledger rows cascade the queue; GL journals are immutable by design and stay.
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM accounts WHERE id = ${TENANT}`;
    await Promise.allSettled([owner.end(), app.end(), provisioning.end()]);
  });

  it("mirrors the whole wallet lifecycle into balanced journals", async () => {
    const message = msgId();

    const topUp = await app.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: CCY,
        amountMinor: 5000n,
        idempotencyKey: `topup:${randomUUID()}`,
      }),
    );
    const reserved = await app.withTenant(TENANT, (tx) =>
      reserve(tx, {
        currency: CCY,
        amountMinor: 300n,
        referenceId: message,
        idempotencyKey: `reserve:${message}`,
      }),
    );
    const committed = await app.withTenant(TENANT, (tx) =>
      commit(tx, {
        referenceId: message,
        idempotencyKey: `commit:${message}`,
      }),
    );

    // Counters are lower bounds, never equalities: the GL is shared, non-tenant-scoped state, and any
    // other spec's ledger movement enqueues into the same queue — so `retrying === 0` would be an
    // equality on state this spec does not own. What matters is that OUR three movements posted, which
    // the per-movement assertions below establish.
    const drained = await drainGlPostingRequests(provisioning.db);
    expect(drained.posted).toBeGreaterThanOrEqual(3);

    // The ADR-0013 #5 matrix, proven against real movements rather than a hand-built payload.
    expect(await journalFor(topUp.txnId)).toMatchObject({
      lineCount: 2,
      currency: CCY,
      debit: "1100",
      credit: "2100",
    });
    expect(await journalFor(reserved.txnId)).toMatchObject({
      lineCount: 2,
      debit: "2100",
      credit: "2110",
    });
    expect(await journalFor(committed.txnId)).toMatchObject({
      lineCount: 2,
      debit: "2110",
      credit: "4100",
    });

    // Every line carries the tenant dimension.
    const topUpJournal = await journalFor(topUp.txnId);
    expect(topUpJournal?.tenantIds).toEqual([TENANT, TENANT]);

    for (const txnId of [topUp.txnId, reserved.txnId, committed.txnId]) {
      expect(await requestStatus(txnId)).toMatchObject({ status: "posted" });
    }
  });

  it("mirrors a refund back to the customer liability", async () => {
    const message = msgId();
    await app.withTenant(TENANT, (tx) =>
      reserve(tx, {
        currency: CCY,
        amountMinor: 200n,
        referenceId: message,
        idempotencyKey: `reserve:${message}`,
      }),
    );
    const refunded = await app.withTenant(TENANT, (tx) =>
      refund(tx, {
        referenceId: message,
        idempotencyKey: `refund:${message}`,
      }),
    );
    await drainGlPostingRequests(provisioning.db);
    expect(await journalFor(refunded.txnId)).toMatchObject({
      lineCount: 2,
      debit: "2110",
      credit: "2100",
    });
  });

  it("posts once no matter how many times the drain runs", async () => {
    const topUp = await app.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: CCY,
        amountMinor: 1000n,
        idempotencyKey: `topup:${randomUUID()}`,
      }),
    );
    await drainGlPostingRequests(provisioning.db);
    await drainGlPostingRequests(provisioning.db);
    await drainGlPostingRequests(provisioning.db);

    // Three drains, one journal. Asserted on THIS movement rather than on the drain counters, which
    // other specs' movements also move.
    expect(await journalCount(topUp.txnId)).toBe(1);
    expect(await requestStatus(topUp.txnId)).toMatchObject({
      status: "posted",
    });
  });

  it("does not enqueue twice when a primitive is replayed", async () => {
    const key = `topup:${randomUUID()}`;
    const first = await app.withTenant(TENANT, (tx) =>
      credit(tx, { currency: CCY, amountMinor: 700n, idempotencyKey: key }),
    );
    const replay = await app.withTenant(TENANT, (tx) =>
      credit(tx, { currency: CCY, amountMinor: 700n, idempotencyKey: key }),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.txnId).toBe(first.txnId);

    // A replay opens no new transaction, so the trigger never fires a second time.
    expect(await requestCount(first.txnId)).toBe(1);
  });

  it("recovers when a crash left the journal posted but the request pending", async () => {
    const topUp = await app.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: CCY,
        amountMinor: 900n,
        idempotencyKey: `topup:${randomUUID()}`,
      }),
    );
    await drainGlPostingRequests(provisioning.db);

    // Exactly the state a crash between the journal insert and the bookkeeping update would leave.
    await owner`
      UPDATE gl_posting_requests SET status = 'pending', posted_journal_id = NULL
      WHERE ledger_txn_id = ${topUp.txnId}`;

    const again = await drainGlPostingRequests(provisioning.db);
    expect(again.recovered).toBeGreaterThanOrEqual(1);

    const after = await requestStatus(topUp.txnId);
    expect(after?.status).toBe("posted");
    expect(after?.journal).not.toBeNull();

    expect(await journalCount(topUp.txnId)).toBe(1);
  });

  it("parks an unpostable payload instead of retrying it forever", async () => {
    // An unbalanced payload can only be injected directly: the trigger builds payloads from real legs,
    // which the subledger's own write-time enforcement already guarantees balance.
    const bogus = await app.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: CCY,
        amountMinor: 400n,
        idempotencyKey: `topup:${randomUUID()}`,
      }),
    );
    await owner`
      UPDATE gl_posting_requests
      SET legs = ${owner.json([
        {
          account_kind: "gateway_clearing",
          direction: "debit",
          amount_minor: "400",
        },
        { account_kind: "customer", direction: "credit", amount_minor: "399" },
      ])}
      WHERE ledger_txn_id = ${bogus.txnId}`;

    const drained = await drainGlPostingRequests(provisioning.db);
    expect(drained.failed).toBeGreaterThanOrEqual(1);

    const parked = await requestStatus(bogus.txnId);
    expect(parked?.status).toBe("failed");
    expect(await journalFor(bogus.txnId)).toBeNull();

    const errs = (await owner`
      SELECT last_error FROM gl_posting_requests WHERE ledger_txn_id = ${bogus.txnId}`) as Row[];
    expect(String(errs[0]?.last_error)).toMatch(/does not balance/);

    // Parked means parked: a later drain must leave it alone rather than loop on it.
    await drainGlPostingRequests(provisioning.db);
    expect(await requestStatus(bogus.txnId)).toMatchObject({
      status: "failed",
      attempts: parked?.attempts,
    });

    /**
     * AND THE STANDING INVARIANT MUST SEE IT. This is the point of invariant 3: a parked request is a
     * movement that never reached the books, the drain's `WHERE status = 'pending'` never looks at it
     * again, and every drain counter reads zero from here on. Without this check the single error log at
     * parking time is the only signal, and it ages out — leaving the books permanently understated with
     * every gate green.
     */
    const withParked = await checkGlInvariants(executor);
    expect(withParked.ok).toBe(false);
    expect(withParked.unpostedMovements.map((m) => m.ledgerTxnId)).toContain(
      bogus.txnId,
    );
    expect(formatGlViolations(withParked)).toMatch(
      /have NOT reached the books/,
    );

    // Resolve it so the file's closing invariant assertion means something. In production this is a
    // human's job — there is deliberately no automatic requeue.
    await owner`DELETE FROM gl_posting_requests WHERE ledger_txn_id = ${bogus.txnId}`;
  });

  it("leaves the general ledger satisfying its standing invariants", async () => {
    const result = await checkGlInvariants(executor);
    expect(formatGlViolations(result)).toContain("OK");
    expect(result.ok).toBe(true);
  });
});
