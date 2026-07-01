// ============================================================================================
// @app/wallet — reserve/commit/refund/credit integration gate (L3, newton).
// tier: `test:integration` (needs a migrated Postgres). Drives the wallet PRIMITIVES through the
// real RLS runtime seam (@app/db withTenant, app_runtime pool) and asserts money-correctness after
// every movement: per-txn trial balance = 0, per-account projection integrity, balance-moves-once,
// overdraw rejection (S5), idempotent replay (B8), and commit-XOR-refund (B6).
// ============================================================================================

import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AlreadyResolvedError,
  commit,
  credit,
  IdempotencyConflictError,
  InsufficientFundsError,
  refund,
  reserve,
} from "../src/index.js";

const OWNER_URL = process.env.DATABASE_URL_OWNER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!OWNER_URL || !APP_URL) {
  throw new Error(
    "test:integration requires DATABASE_URL_OWNER + DATABASE_URL_APP (fresh/isolated migrated DB)",
  );
}

const TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const owner = postgres(OWNER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 5 }); // max>1 so the concurrency test truly races

type Row = Record<string, unknown>;
const msg = (n: string): string => `dddddddd-0000-0000-0000-0000000000${n}`;

async function balances(): Promise<Record<string, bigint>> {
  // Owner (BYPASSRLS) reads this tenant's accounts for assertions.
  const rows = (await owner`
    SELECT kind, balance_minor FROM ledger_accounts WHERE tenant_id = ${TENANT}`) as Row[];
  const out: Record<string, bigint> = {};
  for (const r of rows) out[String(r.kind)] = BigInt(String(r.balance_minor));
  return out;
}

/** Assert the two ledger invariants across this tenant's rows (global sweep as owner). */
async function assertInvariants(): Promise<void> {
  // 1. per-transaction trial balance: SUM(credit) - SUM(debit) = 0 for every txn.
  const txns = (await owner`
    SELECT txn_id, SUM(CASE direction WHEN 'credit' THEN amount_minor ELSE -amount_minor END) AS delta
    FROM ledger_entries WHERE tenant_id = ${TENANT} GROUP BY txn_id HAVING
      SUM(CASE direction WHEN 'credit' THEN amount_minor ELSE -amount_minor END) <> 0`) as Row[];
  expect(txns, "every txn must be balanced (trial balance = 0)").toEqual([]);
  // 2. per-account projection integrity: balance_minor == SUM(credit)-SUM(debit) of its legs.
  const drift = (await owner`
    SELECT a.id FROM ledger_accounts a
    LEFT JOIN ledger_entries e ON e.account_id = a.id
    WHERE a.tenant_id = ${TENANT}
    GROUP BY a.id, a.balance_minor
    HAVING a.balance_minor <> COALESCE(SUM(CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END), 0)`) as Row[];
  expect(drift, "every account projection must equal SUM(legs)").toEqual([]);
}

beforeAll(async () => {
  await owner`INSERT INTO accounts (id, name, slug) VALUES (${TENANT}, 'Wallet Test', 'wallet-test')
    ON CONFLICT (id) DO NOTHING`;
});

afterEach(async () => {
  // Reset ledger between tests (owner bypasses append-only REVOKE; this is test teardown only).
  await owner`DELETE FROM ledger_entries WHERE tenant_id = ${TENANT}`;
  await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${TENANT}`;
  await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${TENANT}`;
});

afterAll(async () => {
  await owner`DELETE FROM accounts WHERE id = ${TENANT}`;
  await Promise.all([owner.end(), db.end()]);
});

describe("@app/wallet reserve/commit/refund/credit", () => {
  it("top-up → reserve → commit: balance moves once, reserved nets to 0, revenue recognized", async () => {
    await db.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 1000n,
        idempotencyKey: "topup:p1",
      }),
    );
    await db.withTenant(TENANT, (tx) =>
      reserve(tx, {
        currency: "GHS",
        amountMinor: 300n,
        idempotencyKey: "reserve:m1",
        referenceId: msg("01"),
      }),
    );
    let b = await balances();
    expect(b.customer).toBe(700n); // 1000 - 300, moved once
    expect(b.reserved_clearing).toBe(300n);
    await assertInvariants();

    await db.withTenant(TENANT, (tx) =>
      commit(tx, { referenceId: msg("01"), idempotencyKey: "commit:m1" }),
    );
    b = await balances();
    expect(b.customer).toBe(700n); // untouched by commit
    expect(b.reserved_clearing).toBe(0n); // nets to zero
    expect(b.revenue).toBe(300n);
    await assertInvariants();
  });

  it("refund restores the customer balance exactly once", async () => {
    await db.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 1000n,
        idempotencyKey: "topup:p2",
      }),
    );
    await db.withTenant(TENANT, (tx) =>
      reserve(tx, {
        currency: "GHS",
        amountMinor: 250n,
        idempotencyKey: "reserve:m2",
        referenceId: msg("02"),
      }),
    );
    await db.withTenant(TENANT, (tx) =>
      refund(tx, { referenceId: msg("02"), idempotencyKey: "refund:m2" }),
    );
    const b = await balances();
    expect(b.customer).toBe(1000n); // fully restored
    expect(b.reserved_clearing).toBe(0n);
    expect(b.revenue ?? 0n).toBe(0n); // no revenue on refund
    await assertInvariants();
  });

  it("rejects overdraw (S5): reserve > balance throws InsufficientFundsError, no money moves", async () => {
    await db.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 100n,
        idempotencyKey: "topup:p3",
      }),
    );
    await expect(
      db.withTenant(TENANT, (tx) =>
        reserve(tx, {
          currency: "GHS",
          amountMinor: 500n,
          idempotencyKey: "reserve:m3",
          referenceId: msg("03"),
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    const b = await balances();
    expect(b.customer).toBe(100n); // unchanged — the failed reserve rolled back
    expect(b.reserved_clearing ?? 0n).toBe(0n);
    await assertInvariants();
  });

  it("idempotent replay (B8): reserving twice with the same key moves money once", async () => {
    await db.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 1000n,
        idempotencyKey: "topup:p4",
      }),
    );
    const first = await db.withTenant(TENANT, (tx) =>
      reserve(tx, {
        currency: "GHS",
        amountMinor: 400n,
        idempotencyKey: "reserve:m4",
        referenceId: msg("04"),
      }),
    );
    const second = await db.withTenant(TENANT, (tx) =>
      reserve(tx, {
        currency: "GHS",
        amountMinor: 400n,
        idempotencyKey: "reserve:m4",
        referenceId: msg("04"),
      }),
    );
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.txnId).toBe(first.txnId);
    const b = await balances();
    expect(b.customer).toBe(600n); // debited once, not twice
    expect(b.reserved_clearing).toBe(400n);
    await assertInvariants();
  });

  it("idempotency conflict (B8): same key + DIFFERENT amount → IdempotencyConflictError, no reuse", async () => {
    await db.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 1000n,
        idempotencyKey: "topup:p7",
      }),
    );
    await db.withTenant(TENANT, (tx) =>
      reserve(tx, {
        currency: "GHS",
        amountMinor: 400n,
        idempotencyKey: "reserve:m7",
        referenceId: msg("07"),
      }),
    );
    // same key, different amount → must NOT silently replay the 400; it's a client bug.
    await expect(
      db.withTenant(TENANT, (tx) =>
        reserve(tx, {
          currency: "GHS",
          amountMinor: 500n,
          idempotencyKey: "reserve:m7",
          referenceId: msg("07"),
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    const b = await balances();
    expect(b.customer).toBe(600n); // only the original 400 reserve applied
    expect(b.reserved_clearing).toBe(400n);
    await assertInvariants();
  });

  it("commit-XOR-refund (B6): refund after commit on the same message throws AlreadyResolvedError", async () => {
    await db.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 1000n,
        idempotencyKey: "topup:p5",
      }),
    );
    await db.withTenant(TENANT, (tx) =>
      reserve(tx, {
        currency: "GHS",
        amountMinor: 200n,
        idempotencyKey: "reserve:m5",
        referenceId: msg("05"),
      }),
    );
    await db.withTenant(TENANT, (tx) =>
      commit(tx, { referenceId: msg("05"), idempotencyKey: "commit:m5" }),
    );
    await expect(
      db.withTenant(TENANT, (tx) =>
        refund(tx, { referenceId: msg("05"), idempotencyKey: "refund:m5" }),
      ),
    ).rejects.toBeInstanceOf(AlreadyResolvedError);
    const b = await balances();
    expect(b.customer).toBe(800n); // committed spend stands; no double resolution
    expect(b.reserved_clearing).toBe(0n);
    expect(b.revenue).toBe(200n);
    await assertInvariants();
  });

  it("concurrency: two racing reserves that together exceed balance → exactly one succeeds", async () => {
    await db.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 1000n,
        idempotencyKey: "topup:p6",
      }),
    );
    // Each wants 700; only one can win (700+700 > 1000). FOR UPDATE on the customer row serializes.
    const results = await Promise.allSettled([
      db.withTenant(TENANT, (tx) =>
        reserve(tx, {
          currency: "GHS",
          amountMinor: 700n,
          idempotencyKey: "reserve:m6a",
          referenceId: msg("6a"),
        }),
      ),
      db.withTenant(TENANT, (tx) =>
        reserve(tx, {
          currency: "GHS",
          amountMinor: 700n,
          idempotencyKey: "reserve:m6b",
          referenceId: msg("6b"),
        }),
      ),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter(
      (r) =>
        r.status === "rejected" && r.reason instanceof InsufficientFundsError,
    ).length;
    expect(ok).toBe(1);
    expect(rejected).toBe(1);
    const b = await balances();
    expect(b.customer).toBe(300n); // exactly one 700 reserve applied
    expect(b.reserved_clearing).toBe(700n);
    await assertInvariants();
  });
});
