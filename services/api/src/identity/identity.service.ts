import type {
  ResolveIdentitySessionRequest,
  ResolveIdentitySessionResponse,
  ResolveStaffSessionRequest,
  ResolveStaffSessionResponse,
} from "@app/contracts";
import {
  accounts,
  memberships,
  type ProvisioningDb,
  staffUsers,
  type TenantId,
  users,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, lte, ne, or, type SQL } from "drizzle-orm";
import { PROVISIONING_DB } from "./provisioning-db.module.js";

const ROLE_PERMISSIONS = {
  owner: [
    "sms:send",
    "sms:read",
    "wallet:read",
    "api_keys:write",
    "api_keys:read",
    "request_logs:read",
  ],
  admin: [
    "sms:send",
    "sms:read",
    "wallet:read",
    "api_keys:read",
    "request_logs:read",
  ],
  member: ["sms:send", "sms:read", "wallet:read"],
} as const;

/** Staff authz is role-based against the platform staff_users table — not tenant permissions. */
const STAFF_ROLE_PERMISSIONS = {
  operator: ["staff:read"],
  admin: ["staff:read", "staff:write"],
} as const;

@Injectable()
export class IdentityService {
  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
  ) {}

  async resolve(
    tenantId: string,
    request: ResolveIdentitySessionRequest,
  ): Promise<ResolveIdentitySessionResponse | null> {
    const scopedTenantId = tenantId as TenantId;
    return this.provisioning.db.transaction(async (tx) => {
      const [account] = await tx
        .select({ id: accounts.id, status: accounts.status })
        .from(accounts)
        .where(
          and(
            eq(accounts.id, scopedTenantId),
            eq(accounts.workosOrganizationId, request.organization_id),
          ),
        )
        .limit(1);
      if (!account || account.status !== "active") return null;

      const now = new Date();
      const sourceUpdatedAt = new Date(request.user_updated_at);
      await tx
        .insert(users)
        .values({
          externalSubjectId: request.external_user_id,
          email: request.email,
          name: request.name,
          workosUpdatedAt: sourceUpdatedAt,
        })
        .onConflictDoUpdate({
          target: users.externalSubjectId,
          set: {
            email: request.email,
            name: request.name,
            workosUpdatedAt: sourceUpdatedAt,
            updatedAt: now,
          },
          setWhere: requiredCondition(
            or(
              isNull(users.workosUpdatedAt),
              lte(users.workosUpdatedAt, sourceUpdatedAt),
            ),
          ),
        })
        .returning({ id: users.id });
      const [user] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.externalSubjectId, request.external_user_id))
        .limit(1);
      if (!user || user.status !== "active") return null;

      const [membership] = await tx
        .insert(memberships)
        .values({
          tenantId: scopedTenantId,
          userId: user.id,
          role: request.role,
          status: "active",
        })
        .onConflictDoUpdate({
          target: [memberships.tenantId, memberships.userId],
          set: { role: request.role, status: "active", updatedAt: now },
          setWhere: ne(memberships.status, "disabled"),
        })
        .returning({ id: memberships.id });
      if (!membership) return null;

      const allowed = new Set<string>(ROLE_PERMISSIONS[request.role]);
      return {
        tenant_id: account.id,
        user_id: user.id,
        role: request.role,
        permissions: request.permissions.filter((item) => allowed.has(item)),
        session_id: request.session_id,
      };
    });
  }

  /**
   * Resolve a WorkOS-authenticated identity to a STAFF session. Authorization is the platform
   * staff_users allowlist (email, provisioned out of band) — a valid WorkOS login is necessary but
   * not sufficient. On success we stamp external_subject_id (first login) + last_seen_at.
   */
  async resolveStaff(
    request: ResolveStaffSessionRequest,
  ): Promise<ResolveStaffSessionResponse | null> {
    const email = request.email.trim().toLowerCase();
    return this.provisioning.db.transaction(async (tx) => {
      const [staff] = await tx
        .select({
          id: staffUsers.id,
          role: staffUsers.role,
          status: staffUsers.status,
        })
        .from(staffUsers)
        .where(eq(staffUsers.email, email))
        .limit(1);
      if (!staff || staff.status !== "active") return null;

      await tx
        .update(staffUsers)
        .set({
          externalSubjectId: request.external_user_id,
          name: request.name,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(staffUsers.id, staff.id));

      return {
        staff_user_id: staff.id,
        role: staff.role,
        permissions: [...STAFF_ROLE_PERMISSIONS[staff.role]],
        session_id: request.session_id,
      };
    });
  }
}

function requiredCondition(condition: SQL | undefined): SQL {
  if (!condition) throw new Error("A database write condition is required.");
  return condition;
}
