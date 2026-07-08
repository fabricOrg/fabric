import { randomUUID } from "node:crypto";
import { accounts, createProvisioningDb, type TenantId } from "@app/db";
import type { WorkOS } from "@workos-inc/node";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("tenant list", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  // list() never calls WorkOS — a bare stub is enough.
  const service = new TenantProvisioningService(db, () => ({}) as WorkOS);
  const a = randomUUID() as TenantId;
  const b = randomUUID() as TenantId;

  beforeAll(async () => {
    await db.db.insert(accounts).values([
      {
        id: a,
        name: "Alpha Co",
        slug: `alpha-${a}`,
        plan: "growth",
        status: "active",
        dataRegion: "af-south-1",
      },
      {
        id: b,
        name: "Beta Co",
        slug: `beta-${b}`,
        plan: "free",
        status: "suspended",
        dataRegion: "af-south-1",
      },
    ]);
  });

  afterAll(async () => {
    await db.db.delete(accounts).where(eq(accounts.id, a));
    await db.db.delete(accounts).where(eq(accounts.id, b));
    await db.end();
  });

  it("returns account rows as tenant summaries", async () => {
    const { tenants } = await service.list();
    const alpha = tenants.find((t) => t.tenant_id === a);
    const beta = tenants.find((t) => t.tenant_id === b);

    expect(alpha).toMatchObject({
      name: "Alpha Co",
      plan: "growth",
      status: "active",
      data_region: "af-south-1",
    });
    expect(beta).toMatchObject({ name: "Beta Co", status: "suspended" });
    // created_at is serialized to an ISO string for the wire.
    expect(typeof alpha?.created_at).toBe("string");
  });
});
