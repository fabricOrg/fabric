import type {
  InviteMemberRequest,
  ListMembersResponse,
  MemberDto,
  UpdateMemberRequest,
} from "@app/contracts";
import {
  accounts,
  memberships,
  type ProvisioningDb,
  type TenantId,
  type UserId,
  users,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import {
  WORKOS_CLIENT,
  type WorkosClientProvider,
} from "../identity/workos-client.provider.js";

/**
 * Team-member management for a tenant. Runs on the provisioning connection (cross-tenant: it reads
 * the account before any tenant context and writes the platform-level users row). The dashboard BFF
 * supplies the tenant id from the authenticated session — never from user input — and gates invite
 * on owner/admin, so this internal endpoint trusts the BFF token (like tenant provisioning).
 *
 * Invite = create an `invited` user (by email; bound to a WorkOS subject on first sign-in) + an
 * `invited` membership, then send a WorkOS organization invitation. The invitation goes out FIRST:
 * if WorkOS rejects it, nothing is written; if the DB write then fails, the worst case is an
 * unbacked invitation (login still fails closed — no membership) that a re-invite reconciles.
 */
@Injectable()
export class MembersService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(WORKOS_CLIENT) private readonly workosClient: WorkosClientProvider,
  ) {}

  async list(tenantId: string): Promise<ListMembersResponse> {
    const rows = await this.provisioning.db
      .select({
        user_id: users.id,
        email: users.email,
        name: users.name,
        role: memberships.role,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.tenantId, tenantId as TenantId))
      .orderBy(asc(users.email));
    return { members: rows };
  }

  async invite(
    tenantId: string,
    request: InviteMemberRequest,
  ): Promise<MemberDto> {
    const scoped = tenantId as TenantId;
    const email = request.email.trim().toLowerCase();

    const [account] = await this.provisioning.db
      .select({
        status: accounts.status,
        organizationId: accounts.workosOrganizationId,
      })
      .from(accounts)
      .where(eq(accounts.id, scoped))
      .limit(1);
    if (!account || account.status !== "active") {
      throw notFound("tenant_not_found", "This organisation is not active.");
    }
    if (!account.organizationId) {
      throw invalidRequest(
        "org_not_provisioned",
        "This organisation has no WorkOS mapping; invites can't be sent.",
      );
    }

    // Reject a re-invite of someone already active — the WorkOS call below would also fail, so guard
    // early with a clear message.
    const [existingUser] = await this.provisioning.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingUser) {
      const [existing] = await this.provisioning.db
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

    // External write first — if WorkOS rejects, nothing is persisted. `developer` is a Fabric-local
    // role with no matching WorkOS org role slug, so omit roleSlug (WorkOS assigns the org default) —
    // our authz reads the LOCAL membership role, not the WorkOS one.
    await this.workosClient().userManagement.sendInvitation({
      email,
      organizationId: account.organizationId,
      ...(request.role === "developer" ? {} : { roleSlug: request.role }),
    });

    return this.provisioning.db.transaction(async (tx) => {
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

      // Fresh invite, or re-arm a previously disabled/invited membership — but never silently demote
      // an active one (guarded above).
      await tx
        .insert(memberships)
        .values({
          tenantId: scoped,
          userId: user.id,
          role: request.role,
          status: "invited",
        })
        .onConflictDoUpdate({
          target: [memberships.tenantId, memberships.userId],
          set: { role: request.role, status: "invited", updatedAt: new Date() },
        });

      return {
        user_id: user.id,
        email,
        name: user.name,
        role: request.role,
        status: "invited" as const,
      };
    });
  }

  /**
   * Change a member's role. The `owner` is immutable through this path — it's singular and set at
   * provisioning, so we neither demote it (would orphan the org) nor let anyone be promoted into it.
   * Purely local: WorkOS org roles aren't touched (Fabric authz reads the local membership role).
   */
  async updateRole(
    tenantId: string,
    userId: string,
    request: UpdateMemberRequest,
  ): Promise<MemberDto> {
    const scoped = tenantId as TenantId;
    const current = await this.requireMembership(scoped, userId);
    if (current.role === "owner") {
      throw invalidRequest(
        "owner_immutable",
        "The owner's role can't be changed here.",
      );
    }
    const [updated] = await this.provisioning.db
      .update(memberships)
      .set({ role: request.role, updatedAt: new Date() })
      .where(
        and(
          eq(memberships.tenantId, scoped),
          eq(memberships.userId, current.userId),
        ),
      )
      .returning({ role: memberships.role, status: memberships.status });
    if (!updated) throw new Error("Membership update returned no row.");
    return {
      user_id: current.userId,
      email: current.email,
      name: current.name,
      role: updated.role,
      status: updated.status,
    };
  }

  /**
   * Remove a member — soft-disable the membership (reversible via re-invite; login fails closed on a
   * disabled membership). The owner can't be removed. WorkOS identity is left intact; access is
   * revoked at the Fabric layer.
   */
  async remove(tenantId: string, userId: string): Promise<void> {
    const scoped = tenantId as TenantId;
    const current = await this.requireMembership(scoped, userId);
    if (current.role === "owner") {
      throw invalidRequest(
        "owner_immutable",
        "The owner can't be removed from the organisation.",
      );
    }
    await this.provisioning.db
      .update(memberships)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(
        and(
          eq(memberships.tenantId, scoped),
          eq(memberships.userId, current.userId),
        ),
      );
  }

  /** Load a membership + its user's identity, or 404. Shared by role-change + remove. */
  private async requireMembership(
    tenantId: TenantId,
    userId: string,
  ): Promise<{
    userId: UserId;
    email: string;
    name: string | null;
    role: MemberDto["role"];
  }> {
    const [row] = await this.provisioning.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(eq(memberships.tenantId, tenantId), eq(users.id, userId as UserId)),
      )
      .limit(1);
    if (!row) throw notFound("member_not_found", "No such member.");
    return row;
  }
}
