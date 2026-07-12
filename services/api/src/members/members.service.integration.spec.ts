import { randomUUID } from "node:crypto";
import {
  accounts,
  createProvisioningDb,
  memberships,
  type TenantId,
  users,
} from "@app/db";
import type { WorkOS } from "@workos-inc/node";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MembersService } from "./members.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("member invites", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const tenantId = randomUUID() as TenantId;
  const organizationId = `org_${randomUUID()}`;
  const email = `teammate-${randomUUID()}@example.com`;
  const devEmail = `dev-${randomUUID()}@example.com`;
  const ownerEmail = `owner-${randomUUID()}@example.com`;
  const sendInvitation = vi.fn(async () => ({}));
  const workos = {
    userManagement: { sendInvitation },
  } as unknown as WorkOS;
  const service = new MembersService(db, () => workos);

  beforeAll(async () => {
    await db.db.insert(accounts).values({
      id: tenantId,
      name: "Members Test",
      slug: `members-${tenantId}`,
      workosOrganizationId: organizationId,
    });
  });

  afterAll(async () => {
    for (const target of [email, devEmail, ownerEmail]) {
      const [user] = await db.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, target));
      if (user) {
        await db.db.delete(memberships).where(eq(memberships.userId, user.id));
        await db.db.delete(users).where(eq(users.id, user.id));
      }
    }
    await db.db.delete(accounts).where(eq(accounts.id, tenantId));
    await db.end();
  });

  it("creates an invited user + membership and sends a WorkOS invitation", async () => {
    const member = await service.invite(tenantId, {
      email,
      role: "member",
      developer_access: false,
    });

    expect(member).toMatchObject({ email, role: "member", status: "invited" });
    expect(sendInvitation).toHaveBeenCalledWith({
      email,
      organizationId,
      roleSlug: "member",
    });

    const [user] = await db.db
      .select({
        status: users.status,
        externalSubjectId: users.externalSubjectId,
      })
      .from(users)
      .where(eq(users.email, email));
    expect(user).toMatchObject({ status: "invited", externalSubjectId: null });

    const [membership] = await db.db
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.tenantId, tenantId));
    expect(membership).toMatchObject({ role: "member", status: "invited" });
  });

  it("lists the invited member", async () => {
    const { members } = await service.list(tenantId);
    expect(members).toEqual([
      expect.objectContaining({ email, role: "member", status: "invited" }),
    ]);
  });

  it("rejects inviting an already-active member", async () => {
    const [user] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    await db.db
      .update(memberships)
      .set({ status: "active" })
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          // biome-ignore lint/style/noNonNullAssertion: seeded in the prior test
          eq(memberships.userId, user!.id),
        ),
      );

    await expect(
      service.invite(tenantId, {
        email,
        role: "admin",
        developer_access: false,
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "already_a_member" } },
    });
  });

  it("fails closed for an unknown tenant", async () => {
    await expect(
      service.invite(randomUUID(), {
        email: "x@example.com",
        role: "member",
        developer_access: false,
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "tenant_not_found" } },
    });
  });

  it("invites a member with independent Developer Portal access", async () => {
    sendInvitation.mockClear();
    const member = await service.invite(tenantId, {
      email: devEmail,
      role: "member",
      developer_access: true,
    });

    expect(member).toMatchObject({
      role: "member",
      developer_access: true,
      status: "invited",
    });
    // `developer` is Fabric-local — WorkOS gets email + org only, no roleSlug.
    expect(sendInvitation).toHaveBeenCalledWith({
      email: devEmail,
      organizationId,
      roleSlug: "member",
    });

    const [membership] = await db.db
      .select({
        role: memberships.role,
        developerAccess: memberships.developerAccess,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(users.email, devEmail));
    expect(membership).toMatchObject({
      role: "member",
      developerAccess: true,
    });
  });

  it("changes a member's role", async () => {
    const [user] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, devEmail));
    // biome-ignore lint/style/noNonNullAssertion: seeded by the developer-invite test
    const updated = await service.updateRole(tenantId, user!.id, {
      role: "admin",
    });
    expect(updated).toMatchObject({
      role: "admin",
      developer_access: true,
      email: devEmail,
    });
  });

  it("soft-removes a member (membership disabled, reversible)", async () => {
    const [user] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, devEmail));
    // biome-ignore lint/style/noNonNullAssertion: seeded by the developer-invite test
    await service.remove(tenantId, user!.id);
    const [membership] = await db.db
      .select({ status: memberships.status })
      .from(memberships)
      // biome-ignore lint/style/noNonNullAssertion: seeded above
      .where(eq(memberships.userId, user!.id));
    expect(membership).toMatchObject({ status: "disabled" });
  });

  it("refuses to change or remove the owner", async () => {
    await db.db
      .insert(users)
      .values({ email: ownerEmail, status: "active" })
      .onConflictDoNothing({ target: users.email });
    const [owner] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ownerEmail));
    // biome-ignore lint/style/noNonNullAssertion: just inserted
    const ownerId = owner!.id;
    await db.db.insert(memberships).values({
      tenantId,
      userId: ownerId,
      role: "owner",
      status: "active",
    });

    await expect(
      service.updateRole(tenantId, ownerId, { role: "admin" }),
    ).rejects.toMatchObject({
      response: { error: { code: "owner_immutable" } },
    });
    await expect(service.remove(tenantId, ownerId)).rejects.toMatchObject({
      response: { error: { code: "owner_immutable" } },
    });
  });

  it("fails closed removing a member that doesn't exist", async () => {
    await expect(service.remove(tenantId, randomUUID())).rejects.toMatchObject({
      response: { error: { code: "member_not_found" } },
    });
  });
});
