// ============================================================================================
// B3 — RUNTIME TENANT-ISOLATION GATE (independent close, QA / adams). tier: test:integration.
// The INDEPENDENT belt to L1's own with-tenant.integration.spec.ts (suspenders): asserts newton's
// merged seam (`createAppDb().withTenant`) enforces per-request tenant context and never leaks across
// pooled requests. `max:1` forces two tenants onto ONE physical connection — the real B3 leak surface
// (a plain `SET` would bleed tenant A's context into tenant B's reused connection).
// Run against a fresh/isolated migrated DB (0000/0001/0002), never the shared `app`.
// ============================================================================================

import { createAppDb, InvalidTenantIdError } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER_URL = process.env.DATABASE_URL_OWNER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!OWNER_URL || !APP_URL) {
  throw new Error(
    "B3 gate requires DATABASE_URL_OWNER + DATABASE_URL_APP (fresh isolated DB)",
  );
}

// owner (BYPASSRLS) seeds; db is L1's RLS-enforced runtime seam, capped at ONE connection.
const owner = postgres(OWNER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 1 });

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// First row of a result that must be non-empty — keeps noUncheckedIndexedAccess happy, fails loud if empty.
function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row, got none");
  return row;
}

async function seedTenant(id: string, slug: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [id, `Tenant ${slug}`, slug],
  );
  await owner.unsafe(
    "INSERT INTO ledger_accounts (tenant_id, kind, currency) VALUES ($1, 'customer', 'GHS') ON CONFLICT (tenant_id, currency, kind) DO NOTHING",
    [id],
  );
}

describe("B3 — runtime tenant isolation (L1 withTenant + SET LOCAL)", () => {
  beforeAll(async () => {
    await owner.unsafe(
      "TRUNCATE ledger_entries, ledger_transactions, ledger_accounts CASCADE",
    );
    await owner.unsafe("DELETE FROM memberships");
    await owner.unsafe("DELETE FROM accounts");
    await seedTenant(TENANT_A, "tenant-a");
    await seedTenant(TENANT_B, "tenant-b");
  });
  afterAll(async () => {
    // Good-citizen cleanup on the SHARED test DB: drop the rows I created so the next spec file's
    // setup (e.g. a plain `DELETE FROM accounts`) isn't blocked by my `ledger_accounts` children
    // (FK RESTRICT, F4). Broader fix = a per-file isolated DB for `test:integration` — flagged to fifi.
    await owner.unsafe(
      "TRUNCATE ledger_entries, ledger_transactions, ledger_accounts CASCADE",
    );
    await owner.unsafe("DELETE FROM accounts");
    await db.end();
    await owner.end();
  });

  // CASE 1 — no tenant context (raw non-owner pool, no withTenant) → fail-closed 0 rows, not all rows.
  it("no app.tenant_id → 0 rows (fail-closed)", async () => {
    const rows = await db.sql<{ id: string }[]>`SELECT id FROM ledger_accounts`;
    expect(
      rows.length,
      "unset tenant context must see nothing, not everything",
    ).toBe(0);
  });

  // CASE 2 — invalid/empty tenant id → withTenant rejects (InvalidTenantIdError) BEFORE any set_config.
  it("invalid/empty tenant id → InvalidTenantIdError before SET LOCAL", async () => {
    await expect(
      db.withTenant("", async () => "unreachable"),
    ).rejects.toBeInstanceOf(InvalidTenantIdError);
    await expect(
      db.withTenant("not-a-uuid", async () => "unreachable"),
    ).rejects.toBeInstanceOf(InvalidTenantIdError);
    // a valid call still works afterward (a rejected call didn't poison the pooled connection)
    const n = await db.withTenant(TENANT_A, async (tx) => {
      const r = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM ledger_accounts`;
      return first(r).n;
    });
    expect(n).toBe(1);
  });

  // CASE 3 — two tenants interleaved on ONE pooled connection → each sees only its own rows.
  it("interleaved tenants on one pooled connection → zero cross-tenant leakage", async () => {
    const aSeenByA = await db.withTenant(TENANT_A, async (tx) => {
      const r = await tx<
        { tenant_id: string }[]
      >`SELECT tenant_id FROM ledger_accounts`;
      return r.map((x) => x.tenant_id);
    });
    // reuses the SAME physical connection A just committed on (max:1) — a leaked plain SET surfaces here
    const bSeenByB = await db.withTenant(TENANT_B, async (tx) => {
      const r = await tx<
        { tenant_id: string }[]
      >`SELECT tenant_id FROM ledger_accounts`;
      return r.map((x) => x.tenant_id);
    });
    expect(aSeenByA).toEqual([TENANT_A]);
    expect(bSeenByB).toEqual([TENANT_B]);
    expect(
      bSeenByB,
      "tenant B must NOT see A on the reused connection",
    ).not.toContain(TENANT_A);
  });

  // CASE 4 (belt: WITH CHECK write-block) — a tenant cannot INSERT a row tagged with another tenant's id.
  it("cross-tenant write is blocked by WITH CHECK", async () => {
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        // tenant A tries to create a ledger account owned by tenant B → policy WITH CHECK must reject
        await tx`INSERT INTO ledger_accounts (tenant_id, kind, currency) VALUES (${TENANT_B}, 'revenue', 'GHS')`;
      }),
    ).rejects.toThrow();
    const leaked = await owner.unsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM ledger_accounts WHERE tenant_id = $1 AND kind = 'revenue'",
      [TENANT_B],
    );
    expect(first(leaked).n).toBe(0);
  });

  // CASE 5 — reused pooled connection, context-less → fail-closed (PHASED, per fifi/newton F6).
  // After a committed tenant tx, `SET LOCAL` has reverted, so a context-less query on the reused
  // connection is fail-closed = 0 rows TODAY. A seam-bypass that left `''` would throw `''::uuid`
  // (loud, still NO leak); newton's `NULLIF(current_setting('app.tenant_id',true),'')::uuid` policy
  // hardening (his F6 follow-up, after L3) makes even that path a clean 0. Assert fail-closed either
  // way (0 rows, tolerating a loud throw) — NOT a regression; tightens to strict 0-rows post-hardening.
  it("reused pooled connection, no context → fail-closed (0 rows today; clean 0 post-NULLIF hardening)", async () => {
    await db.withTenant(TENANT_A, async (tx) => {
      await tx`SELECT 1`;
    });
    let leaked = -1;
    try {
      const rows = await db.sql<
        { id: string }[]
      >`SELECT id FROM ledger_accounts`;
      leaked = rows.length;
    } catch {
      leaked = 0; // loud fail-closed (''::uuid) — no leak; NULLIF hardening turns this into a clean 0
    }
    expect(
      leaked,
      "reused connection must never leak another tenant's rows",
    ).toBe(0);
  });
});
