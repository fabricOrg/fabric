// ============================================================================================
// withTenant — B3 fail-closed integration gate (L1, newton).
// tier: `test:integration` (needs a migrated Postgres). Proves the RUNTIME half of RLS: the
// per-request tenant context set by @app/db's withTenant actually makes the verified DB policies
// filter, and does so in a transaction-pooling-SAFE, fail-closed way.
//
// The 3-case B3 matrix (PRE-IMPLEMENTATION-REVIEW B3) + the pooled-connection leak check:
//   1. context UNSET            → 0 rows (fail-closed, NOT an error)
//   2. invalid/empty tenant id  → rejected BEFORE any set_config / DB round-trip
//   3. two tenants, ONE pooled connection reused → each sees only its own; no residual leak
//
// Uses `accounts` (id IS the tenant_id) as the tenant table under test — the simplest RLS surface.
// Owner (BYPASSRLS) seeds; the app_runtime pool (no bypass) exercises the real runtime.
// ============================================================================================

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppDb, InvalidTenantIdError } from "../src/client.js";

// Prod-faithful owner (653b45d): app_migrator (migration owner) is NON-super → subject to FORCE RLS,
// so cross-tenant seeds need the superuser (DATABASE_URL_SUPER = app_owner, test-only). [harness repoint, adams]
const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "with-tenant.integration requires DATABASE_URL_SUPER + DATABASE_URL_APP (fresh/isolated migrated DB)",
  );
}

// Fixed tenant ids for this spec (namespaced slugs so we don't collide with other integration specs).
const TA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const owner = postgres(SUPER_URL, { max: 2 });
// max:1 on the app pool FORCES both tenant transactions onto the SAME physical connection — the exact
// transaction-pooling scenario where a non-transaction-scoped `SET` would leak. If isolation holds
// here, it holds under any pool size.
const appDb = createAppDb(APP_URL, { max: 1 });

beforeAll(async () => {
  await owner`INSERT INTO accounts (id, name, slug) VALUES
		(${TA}, 'Tenant A', 'wt-tenant-a'),
		(${TB}, 'Tenant B', 'wt-tenant-b')
		ON CONFLICT (id) DO NOTHING`;
});

afterAll(async () => {
  await owner`DELETE FROM accounts WHERE id IN (${TA}, ${TB})`;
  await Promise.all([owner.end(), appDb.end()]);
});

describe("withTenant — B3 fail-closed tenant isolation", () => {
  it("1. no tenant context → 0 rows (fail-closed, not an error)", async () => {
    // Query the app_runtime pool directly with NO withTenant → policies see NULL → 0 rows.
    const rows = await appDb.sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM accounts`;
    expect(rows[0]?.n).toBe(0);
  });

  it("2. invalid / empty tenant id → rejected BEFORE any DB round-trip", async () => {
    let ran = false;
    await expect(
      appDb.withTenant("", async () => {
        ran = true;
        return 1;
      }),
    ).rejects.toBeInstanceOf(InvalidTenantIdError);
    await expect(
      appDb.withTenant("not-a-uuid", async () => {
        ran = true;
        return 1;
      }),
    ).rejects.toBeInstanceOf(InvalidTenantIdError);
    // fn must never run — we reject before opening the transaction / touching Postgres.
    expect(ran).toBe(false);
  });

  it("3. two tenants reusing ONE pooled connection → each sees only its own, no leak", async () => {
    // Tenant A context sees exactly its own row.
    const aSeen = await appDb.withTenant(TA, async (tx) => {
      const all = await tx<{ id: string }[]>`SELECT id FROM accounts`;
      return all.map((r) => r.id);
    });
    expect(aSeen).toEqual([TA]);

    // Same pool (max:1 → same physical connection): Tenant B sees only B — NOT A. Proves the prior
    // transaction's SET LOCAL did not persist onto the reused connection.
    const bSeen = await appDb.withTenant(TB, async (tx) => {
      const all = await tx<{ id: string }[]>`SELECT id FROM accounts`;
      return all.map((r) => r.id);
    });
    expect(bSeen).toEqual([TB]);

    // A concurrent interleave on the same pool must also stay isolated (no cross-bleed).
    const [a2, b2] = await Promise.all([
      appDb.withTenant(TA, async (tx) => {
        const r = await tx<{ id: string }[]>`SELECT id FROM accounts`;
        return r.map((x) => x.id);
      }),
      appDb.withTenant(TB, async (tx) => {
        const r = await tx<{ id: string }[]>`SELECT id FROM accounts`;
        return r.map((x) => x.id);
      }),
    ]);
    expect(a2).toEqual([TA]);
    expect(b2).toEqual([TB]);

    // A fresh tenant-A context on the reused connection STILL sees only A — proving no residual
    // context leaked back from B's transaction onto the pooled connection.
    const a3 = await appDb.withTenant(TA, async (tx) => {
      const r = await tx<{ id: string }[]>`SELECT id FROM accounts`;
      return r.map((x) => x.id);
    });
    expect(a3).toEqual([TA]);

    // SECURITY INVARIANT: a context-less query on the reused connection must NEVER return tenant
    // rows. FINDING (flagged to fifi): once a connection has served a tenant, `app.tenant_id`
    // resets to '' (not unset), so `current_setting('app.tenant_id', true)::uuid` throws
    // `invalid input for uuid ""` rather than returning 0 rows — still FAIL-CLOSED (no leak), just
    // loud. Hardening the policies to NULLIF(current_setting(...), '')::uuid would make it a clean
    // 0 rows. Here we assert only the security-critical property: no tenant data is ever returned.
    let leaked = -1;
    try {
      const r = await appDb.sql<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM accounts`;
      leaked = r[0]?.n ?? 0;
    } catch {
      leaked = 0; // threw on ''::uuid → fail-closed, zero rows returned
    }
    expect(leaked).toBe(0);
  });

  it("also gates writes: WITH CHECK blocks tagging a row as another tenant", async () => {
    // Inside tenant A's context, trying to write a B-scoped membership must be blocked by WITH CHECK.
    await expect(
      appDb.withTenant(TA, async (tx) => {
        await tx`INSERT INTO memberships (tenant_id, user_id, role)
					VALUES (${TB}, ${TA}, 'member')`;
      }),
    ).rejects.toBeTruthy();
  });
});
