import type {
  ResolveUserSessionRequest,
  ResolveUserSessionResponse,
} from "@app/contracts";
import { effectivePermissions } from "@app/contracts";
import {
  accounts,
  memberships,
  type ProvisioningDb,
  staffUsers,
  users,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { PROVISIONING_DB } from "./provisioning-db.module.js";

/**
 * ADR-0007 resolve-v2: authenticate the person, return their memberships. No organization input —
 * WorkOS proves WHO; tenancy is read from Fabric `memberships` only. Three arrivals:
 *
 *  - Returning user (subject bound): profile refreshed (monotonic guard), memberships listed.
 *  - Invited email (row exists, unbound): subject bound, user activated, and every `invited`
 *    membership in an active account activated — signing in IS accepting the invite.
 *  - Verified stranger: a bare `users` row is created with NO memberships — the dashboard routes
 *    them to onboarding, where create-workspace (WorkspaceProvisioningService) makes the tenant.
 *    An UNVERIFIED stranger is refused; nothing is created.
 *
 * Authorization stays fail-closed downstream: an empty memberships list mints no tenant token.
 */
@Injectable()
export class UserSessionService {
  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
  ) {}

  async resolve(
    request: ResolveUserSessionRequest,
  ): Promise<ResolveUserSessionResponse | null> {
    const email = request.email.trim().toLowerCase();
    return this.provisioning.db.transaction(async (tx) => {
      const now = new Date();
      const sourceUpdatedAt = new Date(request.user_updated_at);

      // 1. Resolve the person — bound subject, invited email awaiting first sign-in, or verified
      //    stranger (created user-only). An email row bound to a DIFFERENT subject is refused.
      const [bound] = await tx
        .select({
          id: users.id,
          status: users.status,
          name: users.name,
          workosUpdatedAt: users.workosUpdatedAt,
        })
        .from(users)
        .where(eq(users.externalSubjectId, request.external_user_id))
        .limit(1);

      let user = bound;
      if (!user) {
        const [byEmail] = await tx
          .select({ id: users.id, externalSubjectId: users.externalSubjectId })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (byEmail?.externalSubjectId) return null;
        if (!byEmail && !request.email_verified) return null;
        if (byEmail) {
          const [activated] = await tx
            .update(users)
            .set({
              externalSubjectId: request.external_user_id,
              name: request.name,
              status: "active",
              workosUpdatedAt: sourceUpdatedAt,
              updatedAt: now,
            })
            .where(eq(users.id, byEmail.id))
            .returning({
              id: users.id,
              status: users.status,
              name: users.name,
              workosUpdatedAt: users.workosUpdatedAt,
            });
          user = activated;
        } else {
          const [created] = await tx
            .insert(users)
            .values({
              email,
              name: request.name,
              externalSubjectId: request.external_user_id,
              status: "active",
              workosUpdatedAt: sourceUpdatedAt,
            })
            .returning({
              id: users.id,
              status: users.status,
              name: users.name,
              workosUpdatedAt: users.workosUpdatedAt,
            });
          user = created;
        }
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
        user = { ...user, name: request.name };
      }
      if (!user || user.status === "disabled") return null;
      const userId = user.id;

      // 2. Signing in accepts every pending invite: activate `invited` memberships whose account
      //    is active. Suspended/closed accounts keep the invite pending — nothing is widened.
      const invited = await tx
        .select({ membershipId: memberships.id })
        .from(memberships)
        .innerJoin(accounts, eq(accounts.id, memberships.tenantId))
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.status, "invited"),
            eq(accounts.status, "active"),
          ),
        );
      if (invited.length > 0) {
        await tx
          .update(memberships)
          .set({ status: "active", updatedAt: now })
          .where(
            inArray(
              memberships.id,
              invited.map((row) => row.membershipId),
            ),
          );
      }

      // 3. Every workspace this person can enter — active memberships in active accounts only.
      const rows = await tx
        .select({
          tenantId: accounts.id,
          workspaceName: accounts.name,
          workspaceSlug: accounts.slug,
          plan: accounts.plan,
          role: memberships.role,
          developerAccess: memberships.developerAccess,
          permissions: memberships.permissions,
        })
        .from(memberships)
        .innerJoin(accounts, eq(accounts.id, memberships.tenantId))
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.status, "active"),
            eq(accounts.status, "active"),
          ),
        )
        .orderBy(accounts.name);

      // 4. Is this person also a Fabric operator? Staff and customers share ONE WorkOS AuthKit app
      //    and sendInvitation carries no per-invite redirect, so a staff invitation's accept link
      //    lands HERE. Reporting the allowlist match lets the dashboard callback send them to the
      //    admin console instead of the onboarding wizard (where they would otherwise create a
      //    stray customer workspace and never find the console). Routing hint only — staff
      //    authorization stays the admin console's own allowlist read.
      const [staff] = await tx
        .select({ id: staffUsers.id })
        .from(staffUsers)
        .where(
          and(eq(staffUsers.email, email), eq(staffUsers.status, "active")),
        )
        .limit(1);

      return {
        user_id: userId,
        email,
        name: user.name,
        staff_realm: Boolean(staff),
        memberships: rows.map((row) => {
          const developerAccess =
            row.developerAccess || row.role === "developer";
          return {
            tenant_id: row.tenantId,
            workspace_name: row.workspaceName,
            workspace_slug: row.workspaceSlug,
            role: row.role === "developer" ? ("member" as const) : row.role,
            developer_access: developerAccess,
            // Effective set: per-user override when customized, else role + developer-access
            // baseline (shared catalog — one source of truth with the dashboard editor).
            permissions: effectivePermissions({
              role: row.role,
              developerAccess,
              override: row.permissions,
            }),
            plan: row.plan,
          };
        }),
        session_id: request.session_id,
      };
    });
  }
}
