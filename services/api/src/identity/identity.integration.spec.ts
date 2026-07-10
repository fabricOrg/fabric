import { randomUUID } from "node:crypto";
import {
  accounts,
  createProvisioningDb,
  memberships,
  type TenantId,
  users,
} from "@app/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityService } from "./identity.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("identity provisioning (invite-only)", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new IdentityService(db);
  const tenantId = randomUUID() as TenantId;
  const organizationId = `org_${randomUUID()}`;
  const externalUserId = `user_${randomUUID()}`;
  const email = `owner-${randomUUID()}@example.com`;

  beforeAll(async () => {
    await db.db.insert(accounts).values({
      id: tenantId,
      name: "Identity Test",
      slug: `identity-${tenantId}`,
      workosOrganizationId: organizationId,
    });
    // Provisioned-but-unbound: an `invited` user (no WorkOS subject yet) + `invited` owner membership,
    // exactly what tenant provisioning writes before the admin's first sign-in.
    const [user] = await db.db
      .insert(users)
      .values({ email, status: "invited" })
      .returning({ id: users.id });
    if (!user) throw new Error("Seed user insert returned no row.");
    await db.db.insert(memberships).values({
      tenantId,
      userId: user.id,
      role: "owner",
      status: "invited",
    });
  });

  afterAll(async () => {
    const [user] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (user) {
      await db.db
        .delete(memberships)
        .where(
          and(
            eq(memberships.tenantId, tenantId),
            eq(memberships.userId, user.id),
          ),
        );
      await db.db.delete(users).where(eq(users.id, user.id));
    }
    await db.db.delete(accounts).where(eq(accounts.id, tenantId));
    await db.end();
  });

  it("binds the WorkOS subject and activates the invite on first login", async () => {
    const resolved = await service.resolve({
      external_user_id: externalUserId,
      organization_id: organizationId,
      email,
      name: "Owner",
      user_updated_at: "2026-07-04T10:00:00.000Z",
      // WorkOS-asserted role/permissions are IGNORED for authz — Fabric membership decides.
      role: "member",
      permissions: ["sms:send"],
      session_id: "session_test",
    });

    // Role + full permission set come from the `owner` membership, not the WorkOS "member" claim.
    expect(resolved).toMatchObject({
      tenant_id: tenantId,
      role: "owner",
      permissions: [
        "sms:send",
        "sms:read",
        "wallet:read",
        "api_keys:write",
        "api_keys:read",
        "request_logs:read",
      ],
      session_id: "session_test",
    });

    const [user] = await db.db
      .select({
        externalSubjectId: users.externalSubjectId,
        status: users.status,
      })
      .from(users)
      .where(eq(users.email, email));
    expect(user?.externalSubjectId).toBe(externalUserId);
    expect(user?.status).toBe("active");

    const [membership] = await db.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(eq(memberships.tenantId, tenantId));
    expect(membership?.status).toBe("active");
  });

  it("resolves a returning (already-bound) login", async () => {
    const resolved = await service.resolve({
      external_user_id: externalUserId,
      organization_id: organizationId,
      email,
      name: "Owner Renamed",
      user_updated_at: "2026-07-05T10:00:00.000Z",
      role: "member",
      permissions: [],
      session_id: "session_test_2",
    });
    expect(resolved).toMatchObject({ tenant_id: tenantId, role: "owner" });
  });

  it("fails closed for an identity with no invite in this org", async () => {
    await expect(
      service.resolve({
        external_user_id: `user_${randomUUID()}`,
        organization_id: organizationId,
        email: `stranger-${randomUUID()}@example.com`,
        name: "Stranger",
        user_updated_at: "2026-07-04T10:00:00.000Z",
        role: "owner",
        permissions: ["sms:send"],
        session_id: "session_test",
      }),
    ).resolves.toBeNull();
  });

  it("fails closed for an unknown WorkOS organization", async () => {
    await expect(
      service.resolve({
        external_user_id: externalUserId,
        organization_id: "org_wrong",
        email,
        name: "Owner",
        user_updated_at: "2026-07-04T10:00:00.000Z",
        role: "owner",
        permissions: ["sms:send"],
        session_id: "session_test",
      }),
    ).resolves.toBeNull();
  });

  it("isActiveTenant gates tenant-token minting on account status (ADR-0003)", async () => {
    await expect(service.isActiveTenant(tenantId)).resolves.toBe(true);
    await db.db
      .update(accounts)
      .set({ status: "suspended" })
      .where(eq(accounts.id, tenantId));
    await expect(service.isActiveTenant(tenantId)).resolves.toBe(false);
    // A suspended tenant's members can't resolve a session either.
    await expect(
      service.resolve({
        external_user_id: externalUserId,
        organization_id: organizationId,
        email,
        name: "Owner",
        user_updated_at: "2026-07-06T10:00:00.000Z",
        role: "member",
        permissions: [],
        session_id: "session_test_3",
      }),
    ).resolves.toBeNull();
    await db.db
      .update(accounts)
      .set({ status: "active" })
      .where(eq(accounts.id, tenantId));
  });
});
