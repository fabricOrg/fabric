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

describeDb("identity provisioning", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new IdentityService(db);
  const tenantId = randomUUID() as TenantId;
  const organizationId = `org_${randomUUID()}`;
  const externalUserId = `user_${randomUUID()}`;

  beforeAll(async () => {
    await db.db.insert(accounts).values({
      id: tenantId,
      name: "Identity Test",
      slug: `identity-${tenantId}`,
      workosOrganizationId: organizationId,
    });
  });

  afterAll(async () => {
    const [user] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalSubjectId, externalUserId));
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

  it("maps WorkOS claims to a local tenant and constrains permissions", async () => {
    const resolved = await service.resolve(tenantId, {
      external_user_id: externalUserId,
      organization_id: organizationId,
      email: "owner@example.com",
      name: "Owner",
      user_updated_at: "2026-07-04T10:00:00.000Z",
      role: "owner",
      permissions: ["sms:send", "wallet:read", "unknown:permission"],
      session_id: "session_test",
    });

    expect(resolved).toMatchObject({
      tenant_id: tenantId,
      role: "owner",
      permissions: ["sms:send", "wallet:read"],
      session_id: "session_test",
    });
    expect(resolved?.user_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("fails closed for a different WorkOS organization", async () => {
    await expect(
      service.resolve(tenantId, {
        external_user_id: externalUserId,
        organization_id: "org_wrong",
        email: "owner@example.com",
        name: "Owner",
        user_updated_at: "2026-07-04T10:00:00.000Z",
        role: "owner",
        permissions: ["sms:send"],
        session_id: "session_test",
      }),
    ).resolves.toBeNull();
  });
});
