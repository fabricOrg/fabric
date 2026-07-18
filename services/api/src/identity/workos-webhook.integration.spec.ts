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
import { UserSessionService } from "./user-session.service.js";
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
    // Invite-only: the webhook RECONCILES an existing membership, it never creates one. Pre-provision
    // the invited user (subject bound on first login/user.created) + invited membership, exactly as
    // tenant provisioning would — then the lifecycle events below activate/revoke it.
    const [user] = await db.db
      .insert(users)
      .values({ email: remoteUser.email, status: "invited" })
      .returning({ id: users.id });
    if (!user) throw new Error("Seed user insert returned no row.");
    await db.db.insert(memberships).values({
      tenantId,
      userId: user.id,
      role: "member",
      status: "invited",
    });
  });

  afterAll(async () => {
    const [user] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, remoteUser.email));
    if (user) {
      await db.db.delete(memberships).where(eq(memberships.userId, user.id));
      await db.db.delete(users).where(eq(users.id, user.id));
    }
    await db.db.delete(accounts).where(eq(accounts.id, tenantId));
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

    // ADR-0007: a disabled membership disappears from resolve-v2 — no workspace access remains.
    const resolved = await new UserSessionService(db).resolve({
      external_user_id: externalUserId,
      email: remoteUser.email,
      name: remoteUser.name,
      user_updated_at: remoteUser.updatedAt,
      email_verified: true,
      session_id: "stale_session",
    });
    expect(
      resolved?.memberships.find((m) => m.tenant_id === tenantId),
    ).toBeUndefined();
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
