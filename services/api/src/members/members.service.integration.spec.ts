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
    const [user] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (user) {
      await db.db.delete(memberships).where(eq(memberships.userId, user.id));
      await db.db.delete(users).where(eq(users.id, user.id));
    }
    await db.db.delete(accounts).where(eq(accounts.id, tenantId));
    await db.end();
  });

  it("creates an invited user + membership and sends a WorkOS invitation", async () => {
    const member = await service.invite(tenantId, { email, role: "member" });

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
      service.invite(tenantId, { email, role: "admin" }),
    ).rejects.toMatchObject({
      response: { error: { code: "already_a_member" } },
    });
  });

  it("fails closed for an unknown tenant", async () => {
    await expect(
      service.invite(randomUUID(), { email: "x@example.com", role: "member" }),
    ).rejects.toMatchObject({
      response: { error: { code: "tenant_not_found" } },
    });
  });
});
