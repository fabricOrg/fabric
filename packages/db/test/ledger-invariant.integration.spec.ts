// ============================================================================================
// LEDGER INVARIANT — integration spec (QA / adams).
// tier: `test:integration` (vitest.integration.config.ts) · needs a migrated Postgres.
// Bound to `ledger-double-entry` v1.0.0. Exercises the ratified reserve→commit→refund lifecycle and
// asserts BOTH invariants after every movement, plus the ratified negative-balance separation and the
// two B6 DB backstops. Posts ledger legs directly (FakeProvider-independent) so it runs at Iter-2.
//
// DRIVER: postgres.js (`postgres`) — the driver @app/db ships. TWO ROLES (newton's runtime model):
//   • owner (DATABASE_URL_OWNER, BYPASSRLS) — setup/seed/TRUNCATE + the GLOBAL invariant sweep.
//   • app   (DATABASE_URL_APP, app_runtime, NO bypass) + `SET LOCAL app.tenant_id` — the tenant-scoped
//     posting path, so the test exercises the REAL RLS runtime, not just the ledger math.
// Both URLs point at a fresh/isolated migrated DB (never the shared dev DB) — redline respected.
// ============================================================================================

import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkLedgerInvariants,
  formatViolations,
} from "./ledger-invariant.check.js";

const OWNER_URL = process.env.DATABASE_URL_OWNER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!OWNER_URL || !APP_URL) {
  throw new Error(
    "test:integration requires DATABASE_URL_OWNER + DATABASE_URL_APP (fresh/isolated migrated DB)",
  );
}

const owner = postgres(OWNER_URL, { max: 4 });
const app = postgres(APP_URL, { max: 4 });

// A DB row is a bag of dynamically-typed columns; narrow at each use site (never `any`, per CONVENTIONS).
type Row = Record<string, unknown>;
type Querier = (sql: string, args?: unknown[]) => Promise<Row[]>;

// The first row of a result that must be non-empty (RETURNING / count(*) always yield one). Keeps
// `noUncheckedIndexedAccess` happy without non-null assertions, and fails loudly if the query returns none.
function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row, got none");
  return row;
}

// Run a tenant-scoped transaction the way the runtime must: SET LOCAL first, then the work.
function inTenantTxn<T>(
  tenantId: string,
  fn: (q: Querier) => Promise<T>,
): Promise<T> {
  return app.begin(async (tx) => {
    // set_config(..., true) == SET LOCAL: transaction-scoped, so a pooled connection can't leak it.
    await tx.unsafe("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return fn(
      (q, args) => tx.unsafe(q, (args ?? []) as never[]) as Promise<Row[]>,
    );
  }) as Promise<T>;
}

// Lazy-provision (PROPOSAL §8: LAZY) a customer/system account and return its id.
async function accountId(
  q: Querier,
  tenantId: string,
  kind: string,
  ccy = "GHS",
): Promise<string> {
  const rows = await q(
    `INSERT INTO ledger_accounts (tenant_id, kind, currency)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, currency, kind) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [tenantId, kind, ccy],
  );
  return String(first(rows).id);
}

// Post a balanced 2-leg transaction and update both accounts' cached projections in the same txn.
async function post(
  q: Querier,
  tenantId: string,
  opts: {
    type: string;
    reason: string;
    debit: string;
    credit: string;
    amount: bigint;
    idemKey: string;
    refId?: string;
  },
): Promise<void> {
  const txn = await q(
    `INSERT INTO ledger_transactions (tenant_id, type, status, idempotency_key)
     VALUES ($1, $2, 'pending', $3) RETURNING id`,
    [tenantId, opts.type, opts.idemKey],
  );
  const txnId = first(txn).id;
  for (const [accId, dir] of [
    [opts.debit, "debit"],
    [opts.credit, "credit"],
  ] as const) {
    await q(
      `INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        txnId,
        accId,
        dir,
        opts.amount.toString(),
        opts.reason,
        opts.refId ?? null,
      ],
    );
    const delta = dir === "credit" ? opts.amount : -opts.amount;
    await q(
      `UPDATE ledger_accounts SET balance_minor = balance_minor + $2, version = version + 1 WHERE id = $1`,
      [accId, delta.toString()],
    );
  }
}

const TENANT = "11111111-1111-1111-1111-111111111111";
// Message references are uuid columns (ledger_entries.reference_id / ledger_transactions.reference_id),
// so use real uuids — not "msg-N" strings.
const MSG1 = "a0000000-0000-0000-0000-000000000001";
const MSG2 = "a0000000-0000-0000-0000-000000000002";
const MSG3 = "a0000000-0000-0000-0000-000000000003";
const MSG4 = "a0000000-0000-0000-0000-000000000004";

// The GLOBAL invariant sweep runs as owner (BYPASSRLS) so it sees every tenant's rows.
async function assertHealthy() {
  const r = await checkLedgerInvariants({
    query: async (q) => ({ rows: (await owner.unsafe(q)) as Row[] }),
  });
  expect(r.ok, formatViolations(r)).toBe(true);
}

describe("ledger invariants (trial balance + projection integrity)", () => {
  beforeEach(async () => {
    await owner.unsafe(
      "TRUNCATE ledger_entries, ledger_transactions, ledger_accounts CASCADE",
    );
    // Seed the tenant's accounts row (ledger_accounts.tenant_id → accounts.id FK). Owner bypasses RLS.
    await owner.unsafe(
      "INSERT INTO accounts (id, name, slug) VALUES ($1, 'Test Tenant', 'test-tenant') ON CONFLICT (id) DO NOTHING",
      [TENANT],
    );
  });
  afterAll(async () => {
    await owner.end();
    await app.end();
  });

  it("top-up → reserve → commit keeps every txn balanced and projections exact", async () => {
    await inTenantTxn(TENANT, async (q) => {
      const customer = await accountId(q, TENANT, "customer");
      const gateway = await accountId(q, TENANT, "gateway_clearing");
      const reserved = await accountId(q, TENANT, "reserved_clearing");
      const revenue = await accountId(q, TENANT, "revenue");

      // Top-up 1000: DEBIT gateway_clearing / CREDIT customer
      await post(q, TENANT, {
        type: "topup",
        reason: "topup",
        debit: gateway,
        credit: customer,
        amount: 1000n,
        idemKey: "topup:abc",
      });
      // Reserve 300: DEBIT customer / CREDIT reserved_clearing  (balance ↓ once)
      await post(q, TENANT, {
        type: "sms_charge",
        reason: "sms_reserve",
        debit: customer,
        credit: reserved,
        amount: 300n,
        idemKey: `reserve:${MSG1}`,
        refId: MSG1,
      });
      // Commit: DEBIT reserved_clearing / CREDIT revenue  (customer untouched)
      await post(q, TENANT, {
        type: "sms_charge",
        reason: "sms_commit",
        debit: reserved,
        credit: revenue,
        amount: 300n,
        idemKey: `commit:${MSG1}`,
        refId: MSG1,
      });
    });
    await assertHealthy();

    // customer = 1000 − 300 = 700; reserved nets to 0; revenue = 300
    const rows = await owner.unsafe(
      "SELECT kind, balance_minor::text AS b FROM ledger_accounts ORDER BY kind",
    );
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
      await post(q, TENANT, {
        type: "topup",
        reason: "topup",
        debit: gateway,
        credit: customer,
        amount: 1000n,
        idemKey: "topup:def",
      });
      await post(q, TENANT, {
        type: "sms_charge",
        reason: "sms_reserve",
        debit: customer,
        credit: reserved,
        amount: 300n,
        idemKey: `reserve:${MSG2}`,
        refId: MSG2,
      });
      await post(q, TENANT, {
        type: "refund",
        reason: "sms_refund",
        debit: reserved,
        credit: customer,
        amount: 300n,
        idemKey: `refund:${MSG2}`,
        refId: MSG2,
      });
    });
    await assertHealthy();
    const rows = await owner.unsafe(
      "SELECT balance_minor::text AS b FROM ledger_accounts WHERE kind='customer'",
    );
    expect(first(rows).b).toBe("1000"); // fully restored, not double-credited
  });

  it("RATIFIED GUARD: negative customer balance is reachable ONLY via adjustment, never via reserve/send", async () => {
    // Fund 100, then a downward reconcile adjustment of 250 (actual > estimate) — allowed to go negative.
    await inTenantTxn(TENANT, async (q) => {
      const customer = await accountId(q, TENANT, "customer");
      const gateway = await accountId(q, TENANT, "gateway_clearing");
      const revenue = await accountId(q, TENANT, "revenue");
      await post(q, TENANT, {
        type: "topup",
        reason: "topup",
        debit: gateway,
        credit: customer,
        amount: 100n,
        idemKey: "topup:ghi",
      });
      await post(q, TENANT, {
        type: "adjustment",
        reason: "adjustment",
        debit: customer,
        credit: revenue,
        amount: 250n,
        idemKey: "adj:1",
      });
    });
    await assertHealthy(); // invariants hold even with a negative customer balance
    const neg = await owner.unsafe(
      "SELECT balance_minor::text AS b FROM ledger_accounts WHERE kind='customer'",
    );
    expect(first(neg).b).toBe("-150");

    // The send/reserve path MUST gate on balance >= cost (S5): a `sms_reserve` debit leg must never
    // exist against a negative customer balance.
    const badReserves = await owner.unsafe(`
      SELECT e.id FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE e.reason = 'sms_reserve' AND e.direction = 'debit' AND a.kind = 'customer'
        AND a.balance_minor < 0
    `);
    expect(
      badReserves.length,
      "a reserve must never be posted against a negative customer balance",
    ).toBe(0);
  });

  // SCOPE NOTE (B6) — TWO DB-level guards, both live at Iter-2 (newton, verified):
  //  (i)  no-double-commit / no-double-refund: deterministic key + UNIQUE(tenant_id, idempotency_key).
  //  (ii) commit-XOR-refund: partial unique index on ledger_transactions
  //       UNIQUE(tenant_id, reference_id) WHERE type='sms_charge' AND status IN ('committed','refunded').
  //  The engine's message-row terminal SM is the PRIMARY guard (F5/Iter-3); these indexes are the backstop.
  it("two concurrent DLRs committing the same message → exactly one commit leg (no double-commit)", async () => {
    await inTenantTxn(TENANT, async (q) => {
      const customer = await accountId(q, TENANT, "customer");
      const gateway = await accountId(q, TENANT, "gateway_clearing");
      const reserved = await accountId(q, TENANT, "reserved_clearing");
      await post(q, TENANT, {
        type: "topup",
        reason: "topup",
        debit: gateway,
        credit: customer,
        amount: 1000n,
        idemKey: "topup:jkl",
      });
      await post(q, TENANT, {
        type: "sms_charge",
        reason: "sms_reserve",
        debit: customer,
        credit: reserved,
        amount: 300n,
        idemKey: `reserve:${MSG3}`,
        refId: MSG3,
      });
    });

    // Two duplicate delivery DLRs race to COMMIT MSG3. Both derive the SAME deterministic key
    // `commit:${MSG3}`; UNIQUE(tenant_id, idempotency_key) lets exactly one insert, the other collides.
    const commitOnce = () =>
      inTenantTxn(TENANT, async (q) => {
        const reserved = await accountId(q, TENANT, "reserved_clearing");
        const revenue = await accountId(q, TENANT, "revenue");
        await post(q, TENANT, {
          type: "sms_charge",
          reason: "sms_commit",
          debit: reserved,
          credit: revenue,
          amount: 300n,
          idemKey: `commit:${MSG3}`,
          refId: MSG3,
        });
      })
        .then(() => "committed")
        .catch((e) => {
          if (/unique|duplicate/i.test(String(e))) return "collided";
          throw e;
        });

    const outcomes = await Promise.all([commitOnce(), commitOnce()]);
    expect(outcomes.filter((o) => o === "committed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "collided")).toHaveLength(1);

    // One commit posts TWO sms_commit legs (debit reserved + credit revenue), so count distinct
    // COMMIT TRANSACTIONS, not legs: exactly one txn must land (the other collides on the idem key).
    const commits = await owner.unsafe(
      "SELECT count(DISTINCT txn_id)::int AS n FROM ledger_entries WHERE reference_id = $1 AND reason = 'sms_commit'",
      [MSG3],
    );
    expect(
      first(commits).n,
      "exactly one commit txn despite two concurrent DLRs (the other collides on the idempotency key)",
    ).toBe(1);
    await assertHealthy(); // revenue = 300 once, not 600; reserved back to 0
  });

  // Guard (ii): commit-XOR-refund. Faithful to newton's live verification — two TERMINAL sms_charge
  // txns for one reference_id (one committed, one refunded) cannot coexist. Distinct idempotency keys,
  // so the collision is the reference_id+status partial index, not the idempotency-key unique.
  it("commit-XOR-refund: a refund cannot land after a commit on the same message (txn partial unique index)", async () => {
    const insertTerminal = (status: "committed" | "refunded", key: string) =>
      inTenantTxn(TENANT, async (q) => {
        await q(
          `INSERT INTO ledger_transactions (tenant_id, type, status, idempotency_key, reference_type, reference_id)
           VALUES ($1, 'sms_charge', $2, $3, 'message', $4)`,
          [TENANT, status, key, MSG4],
        );
      })
        .then(() => "written")
        .catch((e) => {
          if (/unique|duplicate/i.test(String(e))) return "collided";
          throw e;
        });

    expect(await insertTerminal("committed", `commit:${MSG4}`)).toBe("written");
    expect(
      await insertTerminal("refunded", `refund:${MSG4}`),
      "a refund must not land after a commit on the same message",
    ).toBe("collided");

    const terminal = await owner.unsafe(
      `SELECT count(*)::int AS n FROM ledger_transactions
       WHERE reference_id = $1 AND type='sms_charge' AND status IN ('committed','refunded')`,
      [MSG4],
    );
    expect(
      first(terminal).n,
      "at most one terminal-resolution txn per message",
    ).toBe(1);
  });
});
