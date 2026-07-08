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
  // Developer: API/integration surface only. Can mint + manage API keys and read request logs +
  // wallet — but NOT send SMS from the console or manage the org/its members. This is what clears
  // the dev-portal gate (api_keys:*) without granting org-admin rights.
  developer: [
    "wallet:read",
    "api_keys:write",
    "api_keys:read",
    "request_logs:read",
  ],
} as const;

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
   */
  async resolve(
    tenantId: string,
    request: ResolveIdentitySessionRequest,
  ): Promise<ResolveIdentitySessionResponse | null> {
    const scopedTenantId = tenantId as TenantId;
    const email = request.email.trim().toLowerCase();
    return this.provisioning.db.transaction(async (tx) => {
      // 1. The org must exist, be active, and match the WorkOS organization the token was issued for.
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

      // 4. Authorization is the Fabric membership role — WorkOS claims never widen the grant.
      return {
        tenant_id: account.id,
        user_id: user.id,
        role: membership.role,
        permissions: [...ROLE_PERMISSIONS[membership.role]],
        session_id: request.session_id,
      };
    });
  }
}
