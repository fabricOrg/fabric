// ============================================================================================
// The workspace's PRIMARY application — what a request naming no application resolves to. Five
// call sites used to hardcode the slug `default`, so a workspace whose only application was named
// anything else (e.g. one created through the API) could not record a virtual reply, mint a key
// from the operator path, scope a webhook, preview a message, or read its own definitions.
// Runs against a real migrated DB because the ordering is SQL, not TypeScript.
// tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  primaryApplicationId,
  primaryApplicationIdFor,
} from "./primary-application.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;

const owner = postgres(SUPER_URL ?? "", { max: 2 });
const db = createAppDb(APP_URL ?? "", { max: 1 });

/** Only a non-`default` application — the shape that used to break every fallback path. */
const TENANT_RENAMED = randomUUID();
/** Has `default` plus others — must keep resolving to `default`, unchanged behaviour. */
const TENANT_WITH_DEFAULT = randomUUID();
/** No applications at all — must resolve to null, not throw. */
const TENANT_EMPTY = randomUUID();

async function seedTenant(id: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [id, `Primary ${id.slice(0, 8)}`, `primary-${id.slice(0, 8)}`],
  );
}

/** `createdAt` is the tie-break after the `default` preference, so seeding order is meaningful. */
async function seedApp(
  tenantId: string,
  slug: string,
  createdAt: string,
): Promise<string> {
  const rows = (await owner.unsafe(
    `INSERT INTO applications (tenant_id, name, slug, created_at)
     VALUES ($1, $2, $3, $4::timestamptz) RETURNING id`,
    [tenantId, slug, slug, createdAt],
  )) as Array<{ id: string }>;
  const id = rows[0]?.id;
  if (!id) throw new Error(`seed: application ${slug} returned no id`);
  return id;
}

describeDb("primaryApplicationId", () => {
  let renamedOldest = "";
  let defaultApp = "";

  beforeAll(async () => {
    await seedTenant(TENANT_RENAMED);
    await seedTenant(TENANT_WITH_DEFAULT);
    await seedTenant(TENANT_EMPTY);

    // Deliberately no `default` here, and the oldest is NOT alphabetically first — so a passing
    // test can't be explained by incidental ordering.
    renamedOldest = await seedApp(
      TENANT_RENAMED,
      "playground-test",
      "2026-01-01T00:00:00Z",
    );
    await seedApp(TENANT_RENAMED, "another-app", "2026-02-01T00:00:00Z");

    // `default` is seeded LAST so preferring it cannot be confused with preferring the oldest.
    await seedApp(TENANT_WITH_DEFAULT, "early-app", "2026-01-01T00:00:00Z");
    defaultApp = await seedApp(
      TENANT_WITH_DEFAULT,
      "default",
      "2026-03-01T00:00:00Z",
    );
  });

  afterAll(async () => {
    await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2, $3)", [
      TENANT_RENAMED,
      TENANT_WITH_DEFAULT,
      TENANT_EMPTY,
    ]);
    await db.end();
    await owner.end();
  });

  it("resolves the oldest application when the workspace has no `default`", async () => {
    // The reported bug: this workspace's only apps are named something else entirely.
    const id = await primaryApplicationIdFor(db, TENANT_RENAMED);
    expect(id).toBe(renamedOldest);
  });

  it("still prefers `default` when it exists, even if it is the newest", async () => {
    // Unchanged behaviour for every self-serve workspace, which is the point.
    const id = await primaryApplicationIdFor(db, TENANT_WITH_DEFAULT);
    expect(id).toBe(defaultApp);
  });

  it("returns null for a workspace with no applications", async () => {
    // Callers turn this into their own error; the resolver does not invent one.
    const id = await primaryApplicationIdFor(db, TENANT_EMPTY);
    expect(id).toBeNull();
  });

  it("never crosses tenants (RLS)", async () => {
    // Resolution runs inside withTenant, so another workspace's applications are invisible even
    // though this one has none.
    const id = await db.withTenantDrizzle(TENANT_EMPTY, (tx) =>
      primaryApplicationId(tx, TENANT_EMPTY),
    );
    expect(id).toBeNull();
  });

  it("is stable across repeated calls", async () => {
    // Two callers resolving independently (e.g. key creation then webhook scoping) must agree,
    // which is why the ordering carries an id tie-break.
    const first = await primaryApplicationIdFor(db, TENANT_RENAMED);
    const second = await primaryApplicationIdFor(db, TENANT_RENAMED);
    expect(first).toBe(second);
  });
});
