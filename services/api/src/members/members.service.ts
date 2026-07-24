import type {
  InviteMemberRequest,
  ListMembersResponse,
  MemberDto,
  MembershipPermission,
  UpdateMemberRequest,
} from "@app/contracts";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  memberships,
  type ProvisioningDb,
  type TenantId,
  takePage,
  users,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import {
  WORKOS_CLIENT,
  type WorkosClientProvider,
} from "../identity/workos-client.provider.js";
import { toMemberDto } from "./member-dto.js";
import { inviteMember } from "./members-invite.js";
import { requireMembership } from "./members-support.js";

/**
 * Team-member management for a tenant. Runs on the provisioning connection (cross-tenant: it reads
 * the account before any tenant context and writes the platform-level users row). The dashboard BFF
 * supplies the tenant id from the authenticated session — never from user input — and gates invite
 * on owner/admin, so this internal endpoint trusts the BFF token (like tenant provisioning).
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
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<ListMembersResponse> {
    const pageSize = clampLimit(opts.limit);
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    // Standard keyset on (email ASC, user id ASC), within the tenant filter.
    const keyset = keysetWhere(
      users.email,
      users.id,
      "asc",
      decoded ? { primaryValue: decoded.primary, id: decoded.id } : null,
    );
    const rows = await this.provisioning.db
      .select({
        user_id: users.id,
        email: users.email,
        name: users.name,
        role: memberships.role,
        developer_access: memberships.developerAccess,
        status: memberships.status,
        updated_at: memberships.updatedAt,
        permissions: memberships.permissions,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(eq(memberships.tenantId, tenantId as TenantId), keyset))
      .orderBy(asc(users.email), asc(users.id))
      .limit(pageSize + 1);
    const { page, nextCursor } = takePage(rows, pageSize, (r) =>
      encodeCursor(r.email, r.user_id),
    );
    return {
      members: page.map((member) =>
        toMemberDto({
          userId: member.user_id,
          email: member.email,
          name: member.name,
          role: member.role,
          developerAccess: member.developer_access,
          status: member.status,
          updatedAt: member.updated_at,
          override: member.permissions,
        }),
      ),
      next_cursor: nextCursor,
    };
  }

  async invite(
    tenantId: string,
    request: InviteMemberRequest,
    actorEmail: string | null = null,
  ): Promise<MemberDto> {
    const member = await inviteMember(
      this.provisioning,
      this.workosClient,
      tenantId,
      request,
    );
    await this.record(
      actorEmail,
      "member.invited",
      tenantId as TenantId,
      member.user_id,
      { role: request.role, developer_access: request.developer_access },
    );
    return member;
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
    actorEmail: string | null = null,
  ): Promise<MemberDto> {
    const scoped = tenantId as TenantId;
    const current = await requireMembership(this.provisioning, scoped, userId);
    if (current.role === "owner") {
      throw invalidRequest(
        "owner_immutable",
        "The owner's role can't be changed here.",
      );
    }
    const [updated] = await this.provisioning.db
      .update(memberships)
      .set({
        ...(request.role ? { role: request.role } : {}),
        ...(request.developer_access !== undefined
          ? { developerAccess: request.developer_access }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(memberships.tenantId, scoped),
          eq(memberships.userId, current.userId),
        ),
      )
      .returning({
        role: memberships.role,
        developerAccess: memberships.developerAccess,
        status: memberships.status,
        updatedAt: memberships.updatedAt,
        permissions: memberships.permissions,
      });
    if (!updated) throw new Error("Membership update returned no row.");
    await this.record(
      actorEmail,
      "member.role_changed",
      scoped,
      current.userId,
      {
        role: updated.role,
        developer_access: updated.developerAccess,
      },
    );
    return toMemberDto({
      userId: current.userId,
      email: current.email,
      name: current.name,
      role: updated.role,
      developerAccess: updated.developerAccess,
      status: updated.status,
      updatedAt: updated.updatedAt,
      override: updated.permissions,
    });
  }

  /**
   * Set a member's EXACT effective permissions (per-user override). Full override: the array IS the
   * effective set, so the role becomes a template. The owner is protected — its permissions can't be
   * edited (never strip the owner; that would risk locking the workspace out).
   *
   * Authorization (who may call this) is enforced upstream in the BFF/controller. Per the chosen
   * model any admin may grant any permission, INCLUDING ones they don't hold — a deliberate
   * escalation trade-off; revisit if a bounded-by-granter rule is wanted.
   */
  async setPermissions(
    tenantId: string,
    userId: string,
    permissions: readonly MembershipPermission[],
    actorEmail: string | null = null,
  ): Promise<MemberDto> {
    const scoped = tenantId as TenantId;
    const current = await requireMembership(this.provisioning, scoped, userId);
    if (current.role === "owner") {
      throw invalidRequest(
        "owner_immutable",
        "The owner's permissions can't be changed.",
      );
    }
    const [updated] = await this.provisioning.db
      .update(memberships)
      .set({ permissions: [...permissions], updatedAt: new Date() })
      .where(
        and(
          eq(memberships.tenantId, scoped),
          eq(memberships.userId, current.userId),
        ),
      )
      .returning({
        role: memberships.role,
        developerAccess: memberships.developerAccess,
        status: memberships.status,
        updatedAt: memberships.updatedAt,
        permissions: memberships.permissions,
      });
    if (!updated) throw new Error("Membership update returned no row.");
    await this.record(
      actorEmail,
      "member.permissions_changed",
      scoped,
      current.userId,
      { permissions: [...permissions] },
    );
    return toMemberDto({
      userId: current.userId,
      email: current.email,
      name: current.name,
      role: updated.role,
      developerAccess: updated.developerAccess,
      status: updated.status,
      updatedAt: updated.updatedAt,
      override: updated.permissions,
    });
  }

  /**
   * Remove a member — soft-disable the membership (reversible via re-invite; login fails closed on a
   * disabled membership). The owner can't be removed. WorkOS identity is left intact; access is
   * revoked at the Fabric layer.
   */
  async remove(
    tenantId: string,
    userId: string,
    actorEmail: string | null = null,
  ): Promise<void> {
    const scoped = tenantId as TenantId;
    const current = await requireMembership(this.provisioning, scoped, userId);
    if (current.role === "owner") {
      throw invalidRequest(
        "owner_immutable",
        "The owner can't be removed from the organisation.",
      );
    }
    await this.record(actorEmail, "member.removed", scoped, current.userId, {});
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

  /** Append an audit event for a member mutation. Actor attested by the BFF (x-actor-email). */
  private async record(
    actorEmail: string | null,
    action: string,
    tenantId: TenantId,
    targetUserId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      actorEmail,
      action,
      targetType: "membership",
      targetId: targetUserId,
      summary: `${action} in workspace ${tenantId}`,
      metadata: { tenant_id: tenantId, ...metadata },
    });
  }
}
