// ============================================================================================
// APPLICATIONS / ENVIRONMENTS tenant-isolation gate (ADR-0004). tier: test:integration.
// The new Workspace -> Application -> Environment tables are tenant-scoped and join the SAME
// tenant_isolation FORCE-RLS policy as every other tenant table. This asserts the RLS boundary did
// NOT move: tenant B can neither READ nor WRITE tenant A's applications/environments, and an unset
// context fails closed. Run against a fresh/isolated migrated DB (needs 0045 DDL + 0046 RLS).
// ============================================================================================

import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "app/env isolation gate requires DATABASE_URL_SUPER + DATABASE_URL_APP (fresh isolated DB)",
  );
}

// owner = superuser (bypasses FORCE RLS) for cross-tenant seeds/assertions; db is the RLS-enforced seam.
const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 1 });

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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
}

describe("ADR-0004 — applications/environments tenant isolation", () => {
  beforeAll(async () => {
    await owner.unsafe("DELETE FROM environments");
    await owner.unsafe("DELETE FROM applications");
    await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2)", [
      TENANT_A,
      TENANT_B,
    ]);
    await seedTenant(TENANT_A, "tenant-a");
    await seedTenant(TENANT_B, "tenant-b");
    // Tenant A creates a default application + its sandbox environment, through the RLS seam.
    await db.withTenant(TENANT_A, async (tx) => {
      const app = await tx<{ id: string }[]>`
        INSERT INTO applications (tenant_id, name, slug)
        VALUES (${TENANT_A}, 'Default', 'default') RETURNING id`;
      await tx`
        INSERT INTO environments (tenant_id, application_id, type, status)
        VALUES (${TENANT_A}, ${first(app).id}, 'sandbox', 'active')`;
    });
  });
  afterAll(async () => {
    await owner.unsafe("DELETE FROM environments");
    await owner.unsafe("DELETE FROM applications");
    await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2)", [
      TENANT_A,
      TENANT_B,
    ]);
    await db.end();
    await owner.end();
  });

  // A sees its own application + environment.
  it("tenant A sees its own application and environment", async () => {
    const seen = await db.withTenant(TENANT_A, async (tx) => {
      const apps = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM applications`;
      const envs = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM environments`;
      return { apps: first(apps).n, envs: first(envs).n };
    });
    expect(seen).toEqual({ apps: 1, envs: 1 });
  });

  // B sees NONE of A's rows on the reused connection (max:1 → the real cross-tenant leak surface).
  it("tenant B sees zero of tenant A's applications/environments", async () => {
    const seen = await db.withTenant(TENANT_B, async (tx) => {
      const apps = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM applications`;
      const envs = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM environments`;
      return { apps: first(apps).n, envs: first(envs).n };
    });
    expect(seen, "tenant B must not see A's app/env").toEqual({
      apps: 0,
      envs: 0,
    });
  });

  // Unset context → fail-closed 0 rows (not all rows).
  it("no app.tenant_id → 0 applications (fail-closed)", async () => {
    const rows = await db.sql<{ id: string }[]>`SELECT id FROM applications`;
    expect(rows.length, "unset context sees nothing").toBe(0);
  });

  // WITH CHECK blocks a cross-tenant write: B cannot create an application tagged as A.
  it("cross-tenant application write is blocked by WITH CHECK", async () => {
    await expect(
      db.withTenant(TENANT_B, async (tx) => {
        await tx`INSERT INTO applications (tenant_id, name, slug) VALUES (${TENANT_A}, 'Evil', 'evil')`;
      }),
    ).rejects.toThrow();
    const leaked = await owner.unsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM applications WHERE slug = 'evil'",
    );
    expect(first(leaked).n).toBe(0);
  });
});
