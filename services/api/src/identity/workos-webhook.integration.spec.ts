import { randomUUID } from "node:crypto";
import {
  accounts,
  createProvisioningDb,
  memberships,
  type TenantId,
  users,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import type { Event, WorkOS } from "@workos-inc/node";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityService } from "./identity.service.js";
import { WorkosWebhookService } from "./workos-webhook.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("WorkOS identity lifecycle", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const tenantId = randomUUID() as TenantId;
  const organizationId = `org_${randomUUID()}`;
  const externalUserId = `user_${randomUUID()}`;
  const membershipId = `om_${randomUUID()}`;
  const remoteUser = {
    id: externalUserId,
    email: "lifecycle@example.com",
    name: "Lifecycle User",
    updatedAt: "2026-07-04T10:00:00.000Z",
  };
  const workos = {
    userManagement: { getUser: async () => remoteUser },
  } as unknown as WorkOS;
  const service = new WorkosWebhookService(
    db,
    () => workos,
    {} as ConfigService,
  );

  beforeAll(async () => {
    await db.db.insert(accounts).values({
      id: tenantId,
      name: "Lifecycle Test",
      slug: `lifecycle-${tenantId}`,
      workosOrganizationId: organizationId,
    });
  });

  afterAll(async () => {
    await db.db.delete(accounts).where(eq(accounts.id, tenantId));
    await db.db
      .delete(users)
      .where(eq(users.externalSubjectId, externalUserId));
    await db.end();
  });

  it("syncs membership changes, revokes access, and ignores stale retries", async () => {
    await service.apply(userCreatedEvent());
    await service.apply(membershipDeletedEvent("2026-07-04T11:00:00.000Z"));
    await service.apply(membershipEvent("2026-07-04T10:00:00.000Z"));

    const [tombstone] = await db.db
      .select({ status: memberships.status, role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.workosMembershipId, membershipId),
        ),
      );
    expect(tombstone).toEqual({ status: "disabled", role: "admin" });

    await service.apply(membershipEvent("2026-07-04T12:00:00.000Z"));
    const [reactivated] = await db.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(eq(memberships.workosMembershipId, membershipId));
    expect(reactivated?.status).toBe("active");

    await service.apply(membershipDeletedEvent("2026-07-04T13:00:00.000Z"));

    const [revoked] = await db.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(eq(memberships.workosMembershipId, membershipId));
    expect(revoked?.status).toBe("disabled");

    await expect(
      new IdentityService(db).resolve(tenantId, {
        external_user_id: externalUserId,
        organization_id: organizationId,
        email: remoteUser.email,
        name: remoteUser.name,
        user_updated_at: remoteUser.updatedAt,
        role: "admin",
        permissions: ["sms:send"],
        session_id: "stale_session",
      }),
    ).resolves.toBeNull();
  });

  function userCreatedEvent(): Event {
    return {
      id: "event_user_created",
      event: "user.created",
      createdAt: remoteUser.updatedAt,
      context: undefined,
      data: {
        ...remoteUser,
        object: "user",
        emailVerified: true,
        firstName: "Lifecycle",
        lastName: "User",
        profilePictureUrl: null,
        createdAt: remoteUser.updatedAt,
      },
    } as Event;
  }

  function membershipEvent(updatedAt: string): Event {
    return {
      id: `event_${updatedAt}`,
      event: "organization_membership.updated",
      createdAt: updatedAt,
      context: undefined,
      data: {
        id: membershipId,
        object: "organization_membership",
        organizationId,
        organizationName: "Lifecycle Test",
        userId: externalUserId,
        status: "active",
        role: { slug: "admin" },
        roles: [{ slug: "admin" }],
        directoryManaged: false,
        customAttributes: {},
        createdAt: "2026-07-04T09:00:00.000Z",
        updatedAt,
      },
    } as Event;
  }

  function membershipDeletedEvent(createdAt: string): Event {
    return {
      ...membershipEvent(createdAt),
      event: "organization_membership.deleted",
      createdAt,
    } as Event;
  }
});
