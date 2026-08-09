// ============================================================================================
// L2 criterion #4 — `api_keys` possession-scoped auth + `app.api_key_hash` GUC isolation (QA / adams).
// tier: test:integration · Target: packages/db/test/api-key-isolation.integration.spec.ts.
// Bound to pascal's (B-policy) L2 DB layer (feature/f2-3-api-key-auth): `api_keys` FORCE RLS + two
// permissive policies (tenant_isolation FOR ALL, api_key_auth_lookup FOR SELECT USING
// key_hash = current_setting('app.api_key_hash', true)) + `@app/db` withApiKeyLookup(keyHash, fn)
// (set_config('app.api_key_hash', $1, true) — the B3-class discipline this gate enforces).
// Verify-on-merge when the DB layer (+ fifi's NULLIF wrap on policy 1) is on dev.
//
// Real schema: api_keys(id, tenant_id, prefix text NOT NULL, key_hash text UNIQUE NOT NULL,
// env enum('test','live') NOT NULL, scopes jsonb default '[]', status enum('active','revoked') default
// 'active', ...). key_hash = hex SHA-256 (policy 2 is a text compare).
// ============================================================================================

import { createHash } from "node:crypto";
import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDisposableDatabase } from "./disposable-database.js";

// Prod-faithful owner (653b45d): seeds cross-tenant api_keys as the test-only superuser (bypasses FORCE RLS).
const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "api-key gate requires DATABASE_URL_SUPER + DATABASE_URL_APP (fresh isolated DB)",
  );
}

const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 1 }); // max:1 → the pooled-connection leak surface

function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row, got none");
  return row;
}

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const KEY_A = "sk_test_aaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "sk_test_bbbbbbbbbbbbbbbbbbbbbbbb";
const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

async function seedKey(tenant: string, slug: string, rawKey: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [tenant, `Tenant ${slug}`, slug],
  );
  // required cols: tenant_id, prefix, key_hash, env (scopes/status have defaults). Seed as owner (bypass RLS).
  await owner.unsafe(
    "INSERT INTO api_keys (tenant_id, prefix, key_hash, env) VALUES ($1, 'sk_test', $2, 'test')",
    [tenant, sha256(rawKey)],
  );
}

describe("L2 — api_keys possession-scoped auth (app.api_key_hash GUC)", () => {
  beforeAll(async () => {
    // Guarded in BOTH hooks. A precondition checked once does not hold for the whole run:
    // specs execute in parallel, and a sibling guard that checked only setup destroyed a live
    // credential this way.
    await assertDisposableDatabase(owner, {
      fixtureTenantIds: [TENANT_A, TENANT_B],
      spec: "L2 api_keys possession-scoped auth",
    });
    await owner.unsafe("DELETE FROM api_keys");
    await owner.unsafe("DELETE FROM accounts");
    await seedKey(TENANT_A, "tenant-a", KEY_A);
    await seedKey(TENANT_B, "tenant-b", KEY_B);
  });
  afterAll(async () => {
    // Guarded in BOTH hooks. A precondition checked once does not hold for the whole run:
    // specs execute in parallel, and a sibling guard that checked only setup destroyed a live
    // credential this way.
    await assertDisposableDatabase(owner, {
      fixtureTenantIds: [TENANT_A, TENANT_B],
      spec: "L2 api_keys possession-scoped auth",
    });
    await owner.unsafe("DELETE FROM api_keys");
    await owner.unsafe("DELETE FROM accounts");
    await db.end();
    await owner.end();
  });

  // #4a fail-closed: no context at all → the lookup policy matches nothing.
  it("no app.api_key_hash → 0 rows (fail-closed)", async () => {
    const rows = await db.sql<
      { tenant_id: string }[]
    >`SELECT tenant_id FROM api_keys`;
    expect(rows.length, "unset hash context must expose no keys").toBe(0);
  });

  // #4b possession-scoped, via the REAL seam: present key A's hash → resolves ONLY tenant A.
  it("withApiKeyLookup(hash) → resolves ONLY that key's tenant (possession-scoped)", async () => {
    const rows = await db.withApiKeyLookup(sha256(KEY_A), async (tx) => {
      return tx<
        { tenant_id: string }[]
      >`SELECT tenant_id FROM api_keys WHERE status = 'active'`;
    });
    expect(rows.length).toBe(1);
    expect(first(rows).tenant_id).toBe(TENANT_A);
  });

  // #4c unknown hash → 0 rows (SHA-256 is unguessable; can't fish for other tenants' keys).
  it("unknown hash → 0 rows", async () => {
    const rows = await db.withApiKeyLookup(
      sha256("sk_test_nonexistent"),
      async (tx) => {
        return tx<{ tenant_id: string }[]>`SELECT tenant_id FROM api_keys`;
      },
    );
    expect(rows.length).toBe(0);
  });

  // #4d B3-class: SET LOCAL is tx-scoped → after a lookup commits, the reused pooled connection has
  // NO hash context → 0 rows. A plain SET would leak key A's hash to the next request.
  it("hash context does not leak across the pooled connection (SET LOCAL, not SET)", async () => {
    await db.withApiKeyLookup(sha256(KEY_A), async (tx) => tx`SELECT 1`);
    const rows = await db.sql<
      { tenant_id: string }[]
    >`SELECT tenant_id FROM api_keys`;
    expect(
      rows.length,
      "reused connection must not retain the prior request's hash",
    ).toBe(0);
  });

  // #4e SELECT-only: the auth-lookup policy is FOR SELECT; in the hash (no-tenant) context an UPDATE
  // falls under tenant_isolation (tenant_id = NULL → 0 rows) → touches nothing. Auth can't mutate keys.
  it("auth (hash) context cannot write — UPDATE affects 0 rows", async () => {
    const updated = await db.withApiKeyLookup(sha256(KEY_A), async (tx) => {
      const r = await tx<
        { id: string }[]
      >`UPDATE api_keys SET status = 'revoked' RETURNING id`;
      return r.length;
    });
    expect(updated, "the SELECT-only auth policy must not permit writes").toBe(
      0,
    );
    const active = await owner.unsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM api_keys WHERE tenant_id = $1 AND status = 'active'",
      [TENANT_A],
    );
    expect(first(active).n).toBe(1);
  });

  // #4f (fifi's ask) — api_keys management policy fail-closed-CLEAN, mirroring B3 Case 5. An empty
  // app.tenant_id (management context) must return a clean 0 rows, NOT throw `''::uuid`. This GATES
  // the F6 NULLIF wrap on policy 1 (tenant_isolation) — REDS until pascal wraps it with
  // NULLIF(current_setting('app.tenant_id', true), '')::uuid, matching every other tenant policy.
  it("empty app.tenant_id (mgmt context) → clean 0 rows on api_keys (NULLIF consistency, F6)", async () => {
    const rows = await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', '', true)`;
      return tx<{ id: string }[]>`SELECT id FROM api_keys`;
    });
    expect(
      rows.length,
      "empty tenant context on api_keys must fail closed as a CLEAN 0 (no ''::uuid throw)",
    ).toBe(0);
  });
});
