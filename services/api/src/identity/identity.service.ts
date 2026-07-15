import type {
  ResolveIdentitySessionRequest,
  ResolveIdentitySessionResponse,
} from "@app/contracts";
import {
  accounts,
  memberships,
  type ProvisioningDb,
  type TenantId,
  users,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { PROVISIONING_DB } from "./provisioning-db.module.js";

// ADR-0004: `applications:read` is universal — the dashboard's application/environment switcher is a
// core surface everyone in the workspace sees. Creating an application structures the workspace, so
// `applications:write` is an owner/admin action (mirrors org management, not the developer lane).
const ROLE_PERMISSIONS = {
  owner: [
    "sms:send",
    "sms:read",
    "email:send",
    "email:read",
    "wallet:read",
    "applications:read",
    "applications:write",
    "api_keys:read",
    "api_keys:write",
    "request_logs:read",
  ],
  admin: [
    "sms:send",
    "sms:read",
    "email:send",
    "email:read",
    "wallet:read",
    "applications:read",
    "applications:write",
    "api_keys:read",
    "api_keys:write",
    "request_logs:read",
  ],
  member: [
    "sms:send",
    "sms:read",
    "email:send",
    "email:read",
    "wallet:read",
    "applications:read",
  ],
} as const;

const DEVELOPER_PERMISSIONS = [
  "api_keys:write",
  "api_keys:read",
  "request_logs:read",
] as const;

@Injectable()
export class IdentityService {
  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
  ) {}

  /**
   * Resolve a WorkOS-authenticated identity to a CUSTOMER (tenant) session. Invite-only, like staff:
   * a valid WorkOS login is necessary but not sufficient. The user + membership must already exist
   * (provisioned by email at tenant creation); we only BIND the WorkOS subject on first login and
   * ACTIVATE the invite. An identity with no pre-provisioned membership in this org is denied — we
   * never JIT-create access. Role/permissions come from the Fabric membership, not WorkOS claims.
   *
   * ADR-0003: the tenant is resolved HERE from the WorkOS organization the (BFF-verified) sealed
   * session was issued for — `workos_organization_id` is unique — instead of from a tenant-bound
   * API key, so runtime-provisioned tenants work without any pre-shared per-tenant credential.
   */
  async resolve(
    request: ResolveIdentitySessionRequest,
  ): Promise<ResolveIdentitySessionResponse | null> {
    const email = request.email.trim().toLowerCase();
    return this.provisioning.db.transaction(async (tx) => {
      // 1. The WorkOS organization must map to an existing, active account.
      const [account] = await tx
        .select({
          id: accounts.id,
          status: accounts.status,
          plan: accounts.plan,
        })
        .from(accounts)
        .where(eq(accounts.workosOrganizationId, request.organization_id))
        .limit(1);
      if (!account || account.status !== "active") return null;
      const scopedTenantId = account.id as TenantId;

      const now = new Date();
      const sourceUpdatedAt = new Date(request.user_updated_at);

      // 2. Resolve the user — bound by subject id (returning login) or by the invited email awaiting
      //    its first sign-in. NEVER created here; an unknown identity has no invite → denied.
      const [bound] = await tx
        .select({
          id: users.id,
          status: users.status,
          workosUpdatedAt: users.workosUpdatedAt,
        })
        .from(users)
        .where(eq(users.externalSubjectId, request.external_user_id))
        .limit(1);

      let user = bound;
      if (!user) {
        const [invited] = await tx
          .select({ id: users.id, externalSubjectId: users.externalSubjectId })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        // No invited row, or the email is already bound to a different WorkOS identity → refuse.
        if (!invited || invited.externalSubjectId) return null;
        const [activated] = await tx
          .update(users)
          .set({
            externalSubjectId: request.external_user_id,
            name: request.name,
            status: "active",
            workosUpdatedAt: sourceUpdatedAt,
            updatedAt: now,
          })
          .where(eq(users.id, invited.id))
          .returning({
            id: users.id,
            status: users.status,
            workosUpdatedAt: users.workosUpdatedAt,
          });
        user = activated;
      } else if (
        !user.workosUpdatedAt ||
        user.workosUpdatedAt <= sourceUpdatedAt
      ) {
        // Returning login: refresh profile only when WorkOS has a newer copy (monotonic guard).
        await tx
          .update(users)
          .set({
            email,
            name: request.name,
            workosUpdatedAt: sourceUpdatedAt,
            updatedAt: now,
          })
          .where(eq(users.id, user.id));
      }
      if (!user || user.status === "disabled") return null;

      // 3. Membership must already exist for THIS tenant. Activate an invite on first login; never
      //    create one (that's tenant provisioning's job). No/disabled membership → denied.
      const [membership] = await tx
        .select({
          id: memberships.id,
          role: memberships.role,
          developerAccess: memberships.developerAccess,
          status: memberships.status,
        })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, scopedTenantId),
            eq(memberships.userId, user.id),
          ),
        )
        .limit(1);
      if (!membership || membership.status === "disabled") return null;
      if (membership.status === "invited") {
        await tx
          .update(memberships)
          .set({ status: "active", updatedAt: now })
          .where(eq(memberships.id, membership.id));
      }

      const role = membership.role === "developer" ? "member" : membership.role;
      const developerAccess =
        membership.developerAccess || membership.role === "developer";
      return {
        tenant_id: account.id,
        user_id: user.id,
        role,
        developer_access: developerAccess,
        permissions: [
          ...ROLE_PERMISSIONS[role],
          ...(developerAccess ? DEVELOPER_PERMISSIONS : []),
        ],
        session_id: request.session_id,
        plan: account.plan,
      };
    });
  }

  /** True only for an existing, ACTIVE tenant — gates tenant-token minting (ADR-0003), so a
   *  suspended/closed tenant stops getting fresh BFF credentials within one token TTL. */
  async isActiveTenant(tenantId: string): Promise<boolean> {
    const [account] = await this.provisioning.db
      .select({ status: accounts.status })
      .from(accounts)
      .where(eq(accounts.id, tenantId as TenantId))
      .limit(1);
    return account?.status === "active";
  }
}
