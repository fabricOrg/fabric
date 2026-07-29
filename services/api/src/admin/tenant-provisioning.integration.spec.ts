import { randomUUID } from "node:crypto";
import { accounts, createProvisioningDb, type TenantId } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import type { WorkOS } from "@workos-inc/node";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("tenant list", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  // list() calls neither WorkOS nor audit — bare stubs are enough.
  const audit = { record: async () => undefined } as unknown as AuditService;
  const service = new TenantProvisioningService(
    db,
    () => ({}) as WorkOS,
    audit,
    { get: () => undefined } as unknown as ConfigService,
  );
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
        dataRegion: "eu-west-1",
      },
      {
        id: b,
        name: "Beta Co",
        slug: `beta-${b}`,
        plan: "free",
        status: "suspended",
        dataRegion: "eu-west-1",
      },
    ]);
  });

  it("stores and resolves per-workspace sandbox allowance overrides", async () => {
    await expect(service.sandboxAllowancePolicy(a)).resolves.toEqual({
      sms_segments_per_day: 100,
      email_messages_per_day: 200,
    });
    await expect(
      service.updateSandboxAllowancePolicy(
        a,
        {
          sms_segments_per_day: 750,
          email_messages_per_day: 900,
          reason: "Approved test capacity",
        },
        { email: "operator@example.com" },
      ),
    ).resolves.toEqual({
      sms_segments_per_day: 750,
      email_messages_per_day: 900,
    });
    await expect(service.sandboxAllowancePolicy(a)).resolves.toEqual({
      sms_segments_per_day: 750,
      email_messages_per_day: 900,
    });
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
      data_region: "eu-west-1",
    });
    expect(beta).toMatchObject({ name: "Beta Co", status: "suspended" });
    // created_at is serialized to an ISO string for the wire.
    expect(typeof alpha?.created_at).toBe("string");
  });

  it("updateStatus flips status + audits; closed is terminal; no-op rejected (A4)", async () => {
    const actor = { staffId: null, email: "ops@fabric.dev" };

    // active → suspended
    const suspended = await service.updateStatus(
      a,
      { status: "suspended", reason: "chargeback dispute pending" },
      actor,
    );
    expect(suspended.status).toBe("suspended");

    // no-op (already suspended) rejected
    await expect(
      service.updateStatus(
        a,
        { status: "suspended", reason: "again please" },
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 });

    // suspended → closed (terminal)
    const closed = await service.updateStatus(
      a,
      { status: "closed", reason: "account offboarded per request" },
      actor,
    );
    expect(closed.status).toBe("closed");

    // any transition OUT of closed is refused
    await expect(
      service.updateStatus(
        a,
        { status: "active", reason: "try to reopen it" },
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
