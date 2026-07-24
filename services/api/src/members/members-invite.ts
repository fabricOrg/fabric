import type { InviteMemberRequest, MemberDto } from "@app/contracts";
import {
  accounts,
  memberships,
  type ProvisioningDb,
  type TenantId,
  users,
} from "@app/db";
import { and, eq } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";
import type { WorkosClientProvider } from "../identity/workos-client.provider.js";

/**
 * Invite a teammate into a tenant. External write FIRST (an ORG-LESS WorkOS invitation email —
 * ADR-0007: tenancy lives only in Fabric memberships, same shape the staff realm always used) —
 * if WorkOS rejects, nothing is persisted — then the user + `invited` membership are upserted in
 * one transaction. First sign-in binds the subject and resolve-v2 activates the invite. A
 * re-invite re-arms a disabled/invited membership but never silently demotes an active member.
 */
export async function inviteMember(
  db: ProvisioningDb,
  getWorkos: WorkosClientProvider,
  tenantId: string,
  request: InviteMemberRequest,
): Promise<MemberDto> {
  const scoped = tenantId as TenantId;
  const email = request.email.trim().toLowerCase();

  const [account] = await db.db
    .select({ status: accounts.status })
    .from(accounts)
    .where(eq(accounts.id, scoped))
    .limit(1);
  if (!account || account.status !== "active") {
    throw notFound("tenant_not_found", "This organisation is not active.");
  }

  // Reject a re-invite of someone already active — the WorkOS call below would also fail.
  const [existingUser] = await db.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existingUser) {
    const [existing] = await db.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, scoped),
          eq(memberships.userId, existingUser.id),
        ),
      )
      .limit(1);
    if (existing?.status === "active") {
      throw invalidRequest(
        "already_a_member",
        "That person is already an active member of this organisation.",
      );
    }
  }

  // Org-less on purpose: the email is just the onboarding invitation — role and tenancy are the
  // LOCAL membership rows written below, never WorkOS state (ADR-0007). Best-effort like the staff
  // invite: WorkOS rejects sendInvitation for an email that already has a user / pending invite
  // (that person just signs in and binds — no email needed), so a failure must NOT block the local
  // membership that actually grants access. The invited row is the source of truth.
  await getWorkos()
    .userManagement.sendInvitation({ email })
    .catch(() => undefined);

  return db.db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ email, name: request.name ?? null, status: "invited" })
      .onConflictDoNothing({ target: users.email });
    const [user] = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user) throw new Error("Member user upsert returned no row.");

    await tx
      .insert(memberships)
      .values({
        tenantId: scoped,
        userId: user.id,
        role: request.role,
        developerAccess: request.developer_access,
        status: "invited",
      })
      .onConflictDoUpdate({
        target: [memberships.tenantId, memberships.userId],
        set: {
          role: request.role,
          developerAccess: request.developer_access,
          status: "invited",
          updatedAt: new Date(),
        },
      });

    return {
      user_id: user.id,
      email,
      name: user.name,
      role: request.role,
      developer_access: request.developer_access,
      status: "invited" as const,
      updated_at: new Date().toISOString(),
    };
  });
}
