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
import { assertDisposableDatabase } from "./disposable-database.js";

// Prod-faithful owner model (653b45d): app_migrator (migration owner) is NON-super → subject to FORCE
// RLS, so cross-tenant seeds/cleanup need the superuser (DATABASE_URL_SUPER = app_owner, test-only).
const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "B3 gate requires DATABASE_URL_SUPER + DATABASE_URL_APP (fresh isolated DB)",
  );
}

// owner = superuser (bypasses FORCE RLS) for cross-tenant seeds/cleanup; db is L1's RLS-enforced seam.
const owner = postgres(SUPER_URL, { max: 2 });
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
    // Guarded in BOTH hooks. A precondition checked once does not hold for the whole run:
    // specs execute in parallel, and a sibling guard that checked only setup destroyed a live
    // credential this way.
    await assertDisposableDatabase(owner, {
      fixtureTenantIds: [TENANT_A, TENANT_B],
      spec: "B3 runtime tenant isolation",
    });
    await owner.unsafe(
      "TRUNCATE ledger_entries, ledger_transactions, ledger_accounts CASCADE",
    );
    await owner.unsafe("DELETE FROM memberships");
    await owner.unsafe("DELETE FROM accounts");
    await seedTenant(TENANT_A, "tenant-a");
    await seedTenant(TENANT_B, "tenant-b");
  });
  afterAll(async () => {
    // Guarded in BOTH hooks. A precondition checked once does not hold for the whole run:
    // specs execute in parallel, and a sibling guard that checked only setup destroyed a live
    // credential this way.
    await assertDisposableDatabase(owner, {
      fixtureTenantIds: [TENANT_A, TENANT_B],
      spec: "B3 runtime tenant isolation",
    });
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

  // CASE 5 — empty-string context → CLEAN 0 rows (NULLIF hardening, F6; UN-PHASED).
  // `withTenant` rejects `''` before SET LOCAL, so this simulates a seam-bypass that left
  // `app.tenant_id = ''` on the connection (defense-in-depth). The policies now read
  // `NULLIF(current_setting('app.tenant_id', true), '')::uuid` → `NULLIF('','')` = NULL → 0 rows,
  // clean fail-closed. PRE-hardening the bare `''::uuid` cast RAISED (loud, still no leak). No
  // try/catch — assert a clean 0 (this test RED-flags any regression of the hardening).
  it("empty-string app.tenant_id → clean 0 rows (NULLIF hardening; previously a loud ''::uuid throw)", async () => {
    const rows = await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', '', true)`;
      return tx<{ id: string }[]>`SELECT id FROM ledger_accounts`;
    });
    expect(
      rows.length,
      "empty-string context must fail closed as a CLEAN 0 rows (no throw) post-NULLIF",
    ).toBe(0);
  });
});
