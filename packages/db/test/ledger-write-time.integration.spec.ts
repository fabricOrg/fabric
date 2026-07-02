// ============================================================================================
// LEDGER WRITE-TIME ENFORCEMENT gate (QA / adams) — proves REJECTION, not just happy-path.
// tier: test:integration. Human-ratified: the ledger invariants are now correct-by-construction via
// DB triggers (0007), not just app-code + CI. This gate proves the triggers actually REJECT bad writes
// and MAINTAIN the projection with zero app reconcile.
//
// Inserts run as the NON-super app_runtime (via withTenant) — a SUPERUSER BYPASSES triggers, so a
// prod-faithful non-super role is mandatory here (same reason as the non-super owner). Seeds run as
// the superuser (owner) which bypasses RLS to set up cross-tenant fixtures.
//   • Trigger A `trg_ledger_txn_balanced` (DEFERRABLE constraint, at COMMIT): per txn Σsigned=0 AND
//     single-currency → else RAISE. • Trigger B `trg_ledger_apply_entry` (AFTER INSERT): maintains
//     balance_minor + version (the spec posts NO manual balance update).
// ============================================================================================

import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "write-time gate requires DATABASE_URL_SUPER + DATABASE_URL_APP (fresh isolated DB)",
  );
}

const owner = postgres(SUPER_URL, { max: 2 }); // superuser — seeds only (bypasses RLS + triggers)
const db = createAppDb(APP_URL, { max: 2 }); // app_runtime — non-super → triggers FIRE on its inserts

const TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function first<T>(rows: readonly T[]): T {
  const r = rows[0];
  if (r === undefined) throw new Error("expected at least one row");
  return r;
}

describe("ledger write-time enforcement (triggers reject bad writes)", () => {
  beforeEach(async () => {
    await owner.unsafe(
      "TRUNCATE ledger_entries, ledger_transactions, ledger_accounts CASCADE",
    );
    await owner.unsafe(
      "INSERT INTO accounts (id, name, slug) VALUES ($1, 'WT', 'wt-test') ON CONFLICT (id) DO NOTHING",
      [TENANT],
    );
    // seed accounts as superuser (bypasses RLS): GHS customer + revenue, and an NGN revenue for the
    // cross-currency case. balance_minor starts 0.
    await owner.unsafe(
      `INSERT INTO ledger_accounts (tenant_id, kind, currency) VALUES
        ($1,'customer','GHS'),($1,'revenue','GHS'),($1,'revenue','NGN')
       ON CONFLICT (tenant_id, currency, kind) DO NOTHING`,
      [TENANT],
    );
  });
  afterAll(async () => {
    await owner.unsafe(
      "TRUNCATE ledger_entries, ledger_transactions, ledger_accounts CASCADE",
    );
    await owner.unsafe("DELETE FROM accounts WHERE id = $1", [TENANT]);
    await db.end();
    await owner.end();
  });

  async function acctId(kind: string, ccy: string): Promise<string> {
    const r = await owner.unsafe<{ id: string }[]>(
      "SELECT id FROM ledger_accounts WHERE tenant_id=$1 AND kind=$2 AND currency=$3",
      [TENANT, kind, ccy],
    );
    return String(first(r).id);
  }

  // A balanced, single-currency txn commits; Trigger B maintains both balances with NO app reconcile.
  it("balanced txn commits → Trigger B maintains balance_minor (no app update)", async () => {
    const customer = await acctId("customer", "GHS");
    const revenue = await acctId("revenue", "GHS");
    await db.withTenant(TENANT, async (tx) => {
      const t = await tx<{ id: string }[]>`
        INSERT INTO ledger_transactions (tenant_id, type, status, idempotency_key)
        VALUES (current_setting('app.tenant_id')::uuid, 'adjustment', 'pending', 'wt:ok') RETURNING id`;
      const txnId = first(t).id;
      await tx`INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason)
        VALUES (current_setting('app.tenant_id')::uuid, ${txnId}, ${revenue}, 'credit', 100, 'adjustment')`;
      await tx`INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason)
        VALUES (current_setting('app.tenant_id')::uuid, ${txnId}, ${customer}, 'debit', 100, 'adjustment')`;
    });
    const bal = await owner.unsafe<{ kind: string; b: string }[]>(
      "SELECT kind, balance_minor::text AS b FROM ledger_accounts WHERE tenant_id=$1 AND currency='GHS' ORDER BY kind",
      [TENANT],
    );
    const byKind = Object.fromEntries(bal.map((r) => [r.kind, r.b]));
    expect(byKind.customer).toBe("-100"); // trigger-maintained, spec did NO balance UPDATE
    expect(byKind.revenue).toBe("100");
  });

  // Trigger A (deferred) rejects an unbalanced txn AT COMMIT — the tx cannot commit.
  it("unbalanced txn → rejected at COMMIT (Trigger A: Σsigned≠0)", async () => {
    const customer = await acctId("customer", "GHS");
    await expect(
      db.withTenant(TENANT, async (tx) => {
        const t = await tx<{ id: string }[]>`
          INSERT INTO ledger_transactions (tenant_id, type, status, idempotency_key)
          VALUES (current_setting('app.tenant_id')::uuid, 'adjustment', 'pending', 'wt:unbal') RETURNING id`;
        // single debit leg, no matching credit → Σsigned = -100 ≠ 0
        await tx`INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason)
          VALUES (current_setting('app.tenant_id')::uuid, ${first(t).id}, ${customer}, 'debit', 100, 'adjustment')`;
      }),
    ).rejects.toThrow();
  });

  // Trigger A rejects a cross-currency txn (balanced in magnitude, but spans 2 currencies).
  it("cross-currency txn → rejected (Trigger A: >1 currency)", async () => {
    const customerGhs = await acctId("customer", "GHS");
    const revenueNgn = await acctId("revenue", "NGN");
    await expect(
      db.withTenant(TENANT, async (tx) => {
        const t = await tx<{ id: string }[]>`
          INSERT INTO ledger_transactions (tenant_id, type, status, idempotency_key)
          VALUES (current_setting('app.tenant_id')::uuid, 'adjustment', 'pending', 'wt:xccy') RETURNING id`;
        const txnId = first(t).id;
        await tx`INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason)
          VALUES (current_setting('app.tenant_id')::uuid, ${txnId}, ${customerGhs}, 'debit', 100, 'adjustment')`;
        await tx`INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason)
          VALUES (current_setting('app.tenant_id')::uuid, ${txnId}, ${revenueNgn}, 'credit', 100, 'adjustment')`;
      }),
    ).rejects.toThrow();
    // and nothing partial leaked — the rejected txn rolled back fully
    const legs = await owner.unsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1",
      [TENANT],
    );
    expect(first(legs).n).toBe(0);
  });
});
