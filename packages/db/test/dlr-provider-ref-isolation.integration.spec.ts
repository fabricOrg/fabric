// ============================================================================================
// L5 criterion (F5.4) — `messages` DLR possession-scoped resolve + `app.provider_ref` GUC isolation
// (QA / adams). tier: test:integration · mirror of api-key-isolation.integration.spec.ts.
// Bound to newton's DLR seam (migration 0008 `dlr_provider_ref_lookup` FOR SELECT policy +
// `@app/db` withProviderRefLookup(providerRef, fn) → set_config('app.provider_ref', $1, true)).
//
// A provider DLR arrives with only (provider_slug, provider_ref), NO tenant context. The permissive
// SELECT policy exposes ONLY the message whose provider_ref the caller PRESENTS (same (B-policy) shape
// as api_keys; zero SECURITY DEFINER). This gate proves: ref-A → tenant-A ONLY, no ref-B leak,
// unknown → 0, SET-LOCAL (not SET) tx-scoping, SELECT-only (auth can't mutate), and NULLIF-clean fail-closed.
//
// Real schema: messages(id, tenant_id, sender_id, status, encoding enum NOT NULL, segments int NOT NULL,
// cost_minor bigint NOT NULL, currency char(3) NOT NULL, provider_slug text, provider_ref text, ...).
// uniq_messages_provider_ref (provider_slug, provider_ref) WHERE provider_ref IS NOT NULL.
// ============================================================================================

import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Prod-faithful owner (653b45d): seed cross-tenant messages as the test-only superuser (bypasses FORCE RLS).
const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "dlr-ref gate requires DATABASE_URL_SUPER + DATABASE_URL_APP (fresh isolated DB)",
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
const SLUG = "fake-sms";
const REF_A = "ref-aaaaaaaaaaaaaaaa";
const REF_B = "ref-bbbbbbbbbbbbbbbb";

async function seedMessage(tenant: string, slug: string, providerRef: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [tenant, `Tenant ${slug}`, slug],
  );
  // required cols: tenant_id, sender_id, encoding, segments, cost_minor, currency (status defaults).
  // seed as owner (bypass RLS) so both tenants' messages coexist for the isolation assertions.
  await owner.unsafe(
    `INSERT INTO messages (tenant_id, sender_id, status, encoding, segments, cost_minor, currency, provider_slug, provider_ref)
     VALUES ($1, 'BRAND', 'accepted', 'gsm7', 1, 3, 'GHS', $2, $3)`,
    [tenant, SLUG, providerRef],
  );
}

describe("L5 — messages DLR possession-scoped resolve (app.provider_ref GUC)", () => {
  beforeAll(async () => {
    await owner.unsafe("DELETE FROM messages");
    await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2)", [
      TENANT_A,
      TENANT_B,
    ]);
    await seedMessage(TENANT_A, "dlr-tenant-a", REF_A);
    await seedMessage(TENANT_B, "dlr-tenant-b", REF_B);
  });
  afterAll(async () => {
    await owner.unsafe("DELETE FROM messages");
    await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2)", [
      TENANT_A,
      TENANT_B,
    ]);
    await db.end();
    await owner.end();
  });

  // (a) fail-closed: no context at all (no tenant, no provider_ref) → both policies match nothing.
  it("no app.provider_ref → 0 rows (fail-closed)", async () => {
    const rows = await db.sql<{ id: string }[]>`SELECT id FROM messages`;
    expect(rows.length, "unset ref context must expose no messages").toBe(0);
  });

  // (b) possession-scoped via the REAL seam: present ref-A → resolves ONLY tenant A's message,
  //     and CANNOT see ref-B (no cross-tenant leak). This is the core DLR-resolve invariant.
  it("withProviderRefLookup(ref-A) → resolves ONLY tenant A's message (no ref-B leak)", async () => {
    const rows = await db.withProviderRefLookup(REF_A, async (tx) => {
      return tx<
        { tenant_id: string; provider_ref: string }[]
      >`SELECT tenant_id, provider_ref FROM messages`;
    });
    expect(rows.length, "exactly the presented ref's row is visible").toBe(1);
    expect(first(rows).tenant_id).toBe(TENANT_A);
    expect(first(rows).provider_ref).toBe(REF_A);
    // explicit no-leak: ref-B's row must be absent from ref-A's resolve context.
    expect(rows.some((r) => r.provider_ref === REF_B)).toBe(false);
  });

  // (c) unknown ref → 0 rows (a DLR for a ref we never issued resolves to nothing; can't fish tenants).
  it("unknown provider_ref → 0 rows", async () => {
    const rows = await db.withProviderRefLookup(
      "ref-nonexistent",
      async (tx) => {
        return tx<{ tenant_id: string }[]>`SELECT tenant_id FROM messages`;
      },
    );
    expect(rows.length).toBe(0);
  });

  // (d) B3-class: SET LOCAL is tx-scoped → after a resolve commits, the reused pooled connection has
  //     NO ref context → 0 rows. A plain SET would leak ref-A to the next webhook on the same conn.
  it("provider_ref context does not leak across the pooled connection (SET LOCAL, not SET)", async () => {
    await db.withProviderRefLookup(REF_A, async (tx) => tx`SELECT 1`);
    const rows = await db.sql<{ id: string }[]>`SELECT id FROM messages`;
    expect(
      rows.length,
      "reused connection must not retain the prior webhook's provider_ref",
    ).toBe(0);
  });

  // (e) SELECT-only: dlr_provider_ref_lookup is FOR SELECT; in the ref (no-tenant) context an UPDATE
  //     falls under tenant_isolation (tenant_id = NULL → 0 rows) → touches nothing. DLR resolve can't
  //     mutate a message directly; the handler must re-enter via withTenant(resolved tenant_id).
  it("ref context cannot write — UPDATE affects 0 rows", async () => {
    const updated = await db.withProviderRefLookup(REF_A, async (tx) => {
      const r = await tx<
        { id: string }[]
      >`UPDATE messages SET status = 'delivered' RETURNING id`;
      return r.length;
    });
    expect(
      updated,
      "the SELECT-only lookup policy must not permit writes",
    ).toBe(0);
    // and tenant A's message is untouched (still 'accepted').
    const still = await owner.unsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM messages WHERE tenant_id = $1 AND status = 'accepted'",
      [TENANT_A],
    );
    expect(first(still).n).toBe(1);
  });

  // (f) NULLIF-clean fail-closed: an empty app.provider_ref (garbage/empty webhook binding) must return
  //     a CLEAN 0 rows via NULLIF(...,'') → NULL, NOT match every NULL provider_ref nor throw. Mirrors
  //     the api_keys #4f / B3 Case 5 NULLIF consistency check.
  it("empty app.provider_ref → clean 0 rows (NULLIF, no accidental match)", async () => {
    const rows = await db.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.provider_ref', '', true)`;
      return tx<{ id: string }[]>`SELECT id FROM messages`;
    });
    expect(
      rows.length,
      "empty provider_ref must fail closed as a clean 0 (NULLIF → NULL, no match)",
    ).toBe(0);
  });
});
