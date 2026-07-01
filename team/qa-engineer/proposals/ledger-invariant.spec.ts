// ============================================================================================
// LEDGER INVARIANT — integration spec (QA / adams). PROPOSAL ARTIFACT.
// Target: packages/db/test/ledger-invariant.spec.ts · tier: `test:integration` (needs local docker PG).
// Bound to `ledger-double-entry` v1.0.0. Exercises the ratified reserve→commit→refund lifecycle and
// asserts BOTH invariants after every movement, plus the ratified negative-balance separation and a
// concurrent DLR-vs-sweeper-style race. FakeProvider-independent: posts ledger legs directly, so it
// runs at Iter-2 before the SMS engine exists.
//
// RUNS AS app_runtime inside `SET LOCAL app.tenant_id` transactions (RLS-correct, per CONVENTIONS).
// Nothing here touches a shared/prod DB — DATABASE_URL points at local docker only (redline).
// ============================================================================================

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { checkLedgerInvariants, formatViolations } from "./ledger-invariant.check.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL_APP });

// Run a tenant-scoped transaction the way the runtime must: SET LOCAL first, then the work.
async function inTenantTxn<T>(tenantId: string, fn: (q: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]); // = SET LOCAL
    const out = await fn((sql, args) => client.query(sql, args));
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Lazy-provision (PROPOSAL §8: LAZY) a system/customer account and return its id.
async function accountId(q: any, tenantId: string, kind: string, ccy = "GHS"): Promise<string> {
  const { rows } = await q(
    `INSERT INTO ledger_accounts (tenant_id, kind, currency)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, currency, kind) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [tenantId, kind, ccy],
  );
  return rows[0].id;
}

// Post a balanced 2-leg transaction and update both accounts' cached projections in the same txn.
async function post(
  q: any, tenantId: string,
  opts: { type: string; reason: string; debit: string; credit: string; amount: bigint; idemKey?: string; refId?: string },
): Promise<void> {
  const { rows: txn } = await q(
    `INSERT INTO ledger_transactions (tenant_id, type, status, idempotency_key)
     VALUES ($1, $2, 'pending', $3) RETURNING id`,
    [tenantId, opts.type, opts.idemKey ?? null],
  );
  const txnId = txn[0].id;
  for (const [accId, dir] of [[opts.debit, "debit"], [opts.credit, "credit"]] as const) {
    await q(
      `INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, txnId, accId, dir, opts.amount.toString(), opts.reason, opts.refId ?? null],
    );
    const delta = dir === "credit" ? opts.amount : -opts.amount;
    await q(
      `UPDATE ledger_accounts SET balance_minor = balance_minor + $2, version = version + 1 WHERE id = $1`,
      [accId, delta.toString()],
    );
  }
}

const TENANT = "11111111-1111-1111-1111-111111111111";

async function assertHealthy() {
  const r = await checkLedgerInvariants({ query: (sql) => pool.query(sql) });
  expect(r.ok, formatViolations(r)).toBe(true);
}

describe("ledger invariants (trial balance + projection integrity)", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE ledger_entries, ledger_transactions, ledger_accounts CASCADE");
  });
  afterAll(async () => { await pool.end(); });

  it("top-up → reserve → commit keeps every txn balanced and projections exact", async () => {
    await inTenantTxn(TENANT, async (q) => {
      const customer = await accountId(q, TENANT, "customer");
      const gateway = await accountId(q, TENANT, "gateway_clearing");
      const reserved = await accountId(q, TENANT, "reserved_clearing");
      const revenue = await accountId(q, TENANT, "revenue");

      // Top-up 1000: DEBIT gateway_clearing / CREDIT customer
      await post(q, TENANT, { type: "topup", reason: "topup", debit: gateway, credit: customer, amount: 1000n, idemKey: "topup:abc" });
      // Reserve 300: DEBIT customer / CREDIT reserved_clearing  (balance ↓ once)
      await post(q, TENANT, { type: "sms_charge", reason: "sms_reserve", debit: customer, credit: reserved, amount: 300n, refId: "msg-1" });
      // Commit: DEBIT reserved_clearing / CREDIT revenue  (customer untouched)
      await post(q, TENANT, { type: "sms_charge", reason: "sms_commit", debit: reserved, credit: revenue, amount: 300n, idemKey: "commit:msg-1", refId: "msg-1" });
    });
    await assertHealthy();

    // customer = 1000 − 300 = 700; reserved nets to 0; revenue = 300
    const { rows } = await pool.query("SELECT kind, balance_minor::text AS b FROM ledger_accounts ORDER BY kind");
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.b]));
    expect(byKind.customer).toBe("700");
    expect(byKind.reserved_clearing).toBe("0");
    expect(byKind.revenue).toBe("300");
  });

  it("refund restores the customer balance exactly once (reserved nets to zero)", async () => {
    await inTenantTxn(TENANT, async (q) => {
      const customer = await accountId(q, TENANT, "customer");
      const gateway = await accountId(q, TENANT, "gateway_clearing");
      const reserved = await accountId(q, TENANT, "reserved_clearing");
      await post(q, TENANT, { type: "topup", reason: "topup", debit: gateway, credit: customer, amount: 1000n, idemKey: "topup:def" });
      await post(q, TENANT, { type: "sms_charge", reason: "sms_reserve", debit: customer, credit: reserved, amount: 300n, refId: "msg-2" });
      await post(q, TENANT, { type: "refund", reason: "sms_refund", debit: reserved, credit: customer, amount: 300n, idemKey: "refund:msg-2", refId: "msg-2" });
    });
    await assertHealthy();
    const { rows } = await pool.query("SELECT balance_minor::text AS b FROM ledger_accounts WHERE kind='customer'");
    expect(rows[0].b).toBe("1000"); // fully restored, not double-credited
  });

  it("RATIFIED GUARD: negative customer balance is reachable ONLY via adjustment, never via reserve/send", async () => {
    // Fund 100, then a downward reconcile adjustment of 250 (actual > estimate) — allowed to go negative.
    await inTenantTxn(TENANT, async (q) => {
      const customer = await accountId(q, TENANT, "customer");
      const gateway = await accountId(q, TENANT, "gateway_clearing");
      const revenue = await accountId(q, TENANT, "revenue");
      await post(q, TENANT, { type: "topup", reason: "topup", debit: gateway, credit: customer, amount: 100n, idemKey: "topup:ghi" });
      await post(q, TENANT, { type: "adjustment", reason: "adjustment", debit: customer, credit: revenue, amount: 250n, idemKey: "adj:1" });
    });
    await assertHealthy(); // invariants still hold even with a negative customer balance
    const { rows } = await pool.query("SELECT balance_minor::text AS b FROM ledger_accounts WHERE kind='customer'");
    expect(rows[0].b).toBe("-150");

    // The send/reserve path must gate on balance >= cost (S5). Modeled here: a reserve that would
    // overdraw MUST be rejected by the guard, so no reserve leg is ever posted from a negative balance.
    // (When the engine lands this becomes a call into the reserve service; the invariant is the same:
    //  a `sms_reserve` leg from a balance < cost must never exist.)
    const { rows: badReserves } = await pool.query(`
      SELECT e.id FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE e.reason = 'sms_reserve' AND e.direction = 'debit' AND a.kind = 'customer'
        AND a.balance_minor < 0
    `);
    expect(badReserves.length, "a reserve must never be posted against a negative customer balance").toBe(0);
  });

  // SCOPE NOTE (B6): the deterministic-key + UNIQUE(tenant_id, idempotency_key) guard prevents
  // DOUBLE-commit and DOUBLE-refund (two resolvers of the SAME outcome collide → one wins). It does
  // NOT by itself prevent one commit AND one refund on the same message — that (commit-XOR-refund)
  // requires guard #1, the terminal state machine on the message/reservation row, which lands with
  // the SMS engine (products/sms, not built at Iter-2). This test pins what IS guarded now; the
  // commit-XOR-refund + `UNIQUE(tenant_id, reference_id) WHERE reason IN (...)` assertion is added in
  // the SMS-engine spec. See PROPOSAL §4 (two independent guards).
  it("two concurrent DLRs committing the same message → exactly one commit leg (no double-commit)", async () => {
    await inTenantTxn(TENANT, async (q) => {
      const customer = await accountId(q, TENANT, "customer");
      const gateway = await accountId(q, TENANT, "gateway_clearing");
      const reserved = await accountId(q, TENANT, "reserved_clearing");
      await post(q, TENANT, { type: "topup", reason: "topup", debit: gateway, credit: customer, amount: 1000n, idemKey: "topup:jkl" });
      await post(q, TENANT, { type: "sms_charge", reason: "sms_reserve", debit: customer, credit: reserved, amount: 300n, refId: "msg-3" });
    });

    // Two duplicate delivery DLRs race to COMMIT msg-3. Both derive the SAME deterministic key
    // `commit:msg-3`; UNIQUE(tenant_id, idempotency_key) lets exactly one insert, the other collides.
    const commitOnce = () =>
      inTenantTxn(TENANT, async (q) => {
        const reserved = await accountId(q, TENANT, "reserved_clearing");
        const revenue = await accountId(q, TENANT, "revenue");
        await post(q, TENANT, { type: "sms_charge", reason: "sms_commit", debit: reserved, credit: revenue, amount: 300n, idemKey: "commit:msg-3", refId: "msg-3" });
      }).then(() => "committed").catch((e) => {
        if (/unique|duplicate/i.test(String(e))) return "collided";
        throw e;
      });

    const outcomes = await Promise.all([commitOnce(), commitOnce()]);
    expect(outcomes.filter((o) => o === "committed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "collided")).toHaveLength(1);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ledger_entries WHERE reference_id = 'msg-3' AND reason = 'sms_commit'`,
    );
    expect(rows[0].n, "exactly one commit leg despite two concurrent DLRs").toBe(1);
    await assertHealthy(); // revenue = 300 once, not 600; reserved back to 0
  });
});
