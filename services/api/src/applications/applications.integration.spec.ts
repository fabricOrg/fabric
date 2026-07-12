// ============================================================================================
// ADR-0004 — ApplicationsService against a real migrated DB (RLS-enforced). Proves: create births
// an app with a sandbox(active) + live(locked) env; list returns a workspace's apps with their
// envs; a duplicate slug is a structured 400; and one workspace never sees another's apps.
// tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationsService } from "./applications.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;

const owner = postgres(SUPER_URL ?? "", { max: 2 });
const db = createAppDb(APP_URL ?? "", { max: 1 });
const svc = new ApplicationsService(db);

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

async function seedTenant(id: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [id, `Apps ${id.slice(0, 8)}`, `apps-${id.slice(0, 8)}`],
  );
}

describeDb("ADR-0004 ApplicationsService (real RLS)", () => {
  beforeAll(async () => {
    await seedTenant(TENANT_A);
    await seedTenant(TENANT_B);
  });
  afterAll(async () => {
    // Deleting the accounts cascades applications → environments.
    await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2)", [
      TENANT_A,
      TENANT_B,
    ]);
    await db.end();
    await owner.end();
  });

  it("create births an application with a sandbox(active) + live(locked) env", async () => {
    const app = await svc.create(TENANT_A, {
      name: "Checkout",
      slug: "checkout",
    });
    expect(app).toMatchObject({ name: "Checkout", slug: "checkout" });
    const byType = Object.fromEntries(
      app.environments.map((e) => [e.type, e.status]),
    );
    expect(byType).toEqual({ sandbox: "active", live: "locked" });
    expect(app.environments).toHaveLength(2);
  });

  it("list returns the workspace's applications with their environments", async () => {
    const { applications } = await svc.list(TENANT_A);
    const checkout = applications.find((a) => a.slug === "checkout");
    expect(checkout).toBeDefined();
    expect(checkout?.environments.map((e) => e.type).sort()).toEqual([
      "live",
      "sandbox",
    ]);
  });

  it("a duplicate slug in the same workspace is a structured 400", async () => {
    await expect(
      svc.create(TENANT_A, { name: "Checkout 2", slug: "checkout" }),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "application_slug_taken" } },
    });
  });

  it("one workspace never sees another's applications (RLS)", async () => {
    await svc.create(TENANT_B, { name: "Other", slug: "other" });
    const a = await svc.list(TENANT_A);
    const b = await svc.list(TENANT_B);
    expect(a.applications.some((x) => x.slug === "other")).toBe(false);
    expect(b.applications.some((x) => x.slug === "checkout")).toBe(false);
    expect(b.applications.some((x) => x.slug === "other")).toBe(true);
  });
});
