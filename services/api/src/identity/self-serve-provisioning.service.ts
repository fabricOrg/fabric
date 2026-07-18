import type {
  OrganizationForUserRequest,
  OrganizationForUserResponse,
} from "@app/contracts";
import {
  type AppDb,
  accounts,
  applications,
  environments,
  memberships,
  type ProvisioningDb,
  users,
} from "@app/db";
import { credit } from "@app/wallet";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, ne } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { APP_DB } from "../db/db.module.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { PROVISIONING_DB } from "./provisioning-db.module.js";
import {
  deriveSlug,
  SANDBOX_PLAN,
  SANDBOX_SEED_CURRENCY,
  SANDBOX_SEED_MINOR,
  throttled,
} from "./signup-shared.js";
import {
  WORKOS_CLIENT,
  type WorkosClientProvider,
} from "./workos-client.provider.js";

export { SANDBOX_PLAN } from "./signup-shared.js";

/**
 * ADR-0002: resolve an ORG-LESS WorkOS identity to its organization — or, for a verified
 * stranger arriving through the dashboard's sign-up path, provision a sandbox tenant.
 * Existing access is never widened here: a known identity gets the org its membership already
 * points at, and `resolve()` (invite gate) still decides the session afterwards.
 */
@Injectable()
export class SelfServeProvisioningService {
  private readonly logger = new Logger(SelfServeProvisioningService.name);

  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
    @Inject(APP_DB) private readonly appDb: AppDb,
    @Inject(WORKOS_CLIENT) private readonly workosClient: WorkosClientProvider,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
  ) {}

  async organizationForUser(
    request: OrganizationForUserRequest,
  ): Promise<OrganizationForUserResponse | null> {
    const email = request.email.trim().toLowerCase();
    const existing = await this.findExisting(request.external_user_id, email);
    if (existing) return { ...existing, provisioned: false };

    // Stranger. Provisioning is triple-gated: the platform.signup kill-switch (fails closed, flipped
    // live from the admin console — NOT an env flag / deploy), the calling realm (dashboard sends
    // allow_provision, dev-portal doesn't), and a WorkOS-verified email.
    if (!(await this.killSwitch.signupEnabled())) return null;
    if (!request.allow_provision || !request.email_verified) return null;
    if (throttled(email)) return null;
    return this.provisionSandboxTenant(request, email);
  }

  /** A membership (active or still-invited) in a non-closed account wins over provisioning. */
  private async findExisting(
    externalUserId: string,
    email: string,
  ): Promise<{ workos_organization_id: string; tenant_id: string } | null> {
    const [user] = await this.provisioning.db
      .select({ id: users.id, externalSubjectId: users.externalSubjectId })
      .from(users)
      .where(eq(users.externalSubjectId, externalUserId))
      .limit(1);
    const candidate =
      user ??
      (
        await this.provisioning.db
          .select({ id: users.id, externalSubjectId: users.externalSubjectId })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
      )[0];
    // An email row already bound to a DIFFERENT WorkOS identity is not this caller's.
    if (
      !candidate ||
      (candidate.externalSubjectId &&
        candidate.externalSubjectId !== externalUserId)
    ) {
      return null;
    }
    const [found] = await this.provisioning.db
      .select({
        tenantId: accounts.id,
        workosOrganizationId: accounts.workosOrganizationId,
      })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.tenantId))
      .where(
        and(
          eq(memberships.userId, candidate.id),
          inArray(memberships.status, ["active", "invited"]),
          ne(accounts.status, "closed"),
        ),
      )
      .limit(1);
    if (!found?.workosOrganizationId) return null;
    return {
      workos_organization_id: found.workosOrganizationId,
      tenant_id: found.tenantId,
    };
  }

  /**
   * External-first like staff tenant provisioning: WorkOS org + org membership, then the local
   * rows in one transaction; a DB failure deletes the org so nothing orphans. A concurrent
   * duplicate callback loses on the users/accounts unique constraints — we compensate (delete
   * the fresh org) and return whatever the winner created.
   */
  private async provisionSandboxTenant(
    request: OrganizationForUserRequest,
    email: string,
  ): Promise<OrganizationForUserResponse | null> {
    const workos = this.workosClient();
    const workspaceName = deriveWorkspaceName(request.name, email);
    const organization = await workos.organizations.createOrganization({
      name: workspaceName,
    });
    try {
      await workos.userManagement.createOrganizationMembership({
        organizationId: organization.id,
        userId: request.external_user_id,
        roleSlug: "admin",
      });
      const now = new Date();
      const account = await this.provisioning.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(accounts)
          .values({
            name: workspaceName,
            slug: deriveSlug(email),
            plan: SANDBOX_PLAN,
            workosOrganizationId: organization.id,
            status: "active",
          })
          .returning({ id: accounts.id });
        if (!created) throw new Error("Account insert returned no row.");

        // Bind the WorkOS subject NOW (self-serve has no invite to activate later); the
        // conflict target absorbs the duplicate-callback race on a pre-existing email row.
        await tx
          .insert(users)
          .values({
            email,
            name: request.name,
            externalSubjectId: request.external_user_id,
            status: "active",
            workosUpdatedAt: new Date(request.user_updated_at),
          })
          .onConflictDoUpdate({
            target: users.email,
            set: {
              externalSubjectId: request.external_user_id,
              name: request.name,
              status: "active",
              updatedAt: now,
            },
          });
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!owner) throw new Error("Signup user upsert returned no row.");

        await tx.insert(memberships).values({
          tenantId: created.id,
          userId: owner.id,
          role: "owner",
          status: "active",
        });

        // ADR-0004: a workspace is born with a default application + a sandbox environment (active)
        // and a live environment (LOCKED until go-live unlocks it — the compliance gate applies to
        // self-serve and ops-provisioned tenants alike). Same shape as the ops path and the backfill.
        const [app] = await tx
          .insert(applications)
          .values({ tenantId: created.id, name: "Default", slug: "default" })
          .returning({ id: applications.id });
        if (!app)
          throw new Error("Default application insert returned no row.");
        await tx.insert(environments).values([
          {
            tenantId: created.id,
            applicationId: app.id,
            type: "sandbox",
            status: "active",
          },
          {
            tenantId: created.id,
            applicationId: app.id,
            type: "live",
            status: "locked",
          },
        ]);
        return created;
      });

      // F3: seed ledgered test credits (idempotent on the tenant) so the first sandbox send
      // works immediately. Best-effort — a seeding hiccup must not fail the signup; the tenant
      // just starts at zero and support can re-seed.
      try {
        await this.appDb.withTenant(account.id, (tx) =>
          credit(tx, {
            currency: SANDBOX_SEED_CURRENCY,
            amountMinor: SANDBOX_SEED_MINOR,
            idempotencyKey: `signup-seed-${account.id}`,
          }),
        );
      } catch (error) {
        this.logger.error(
          `sandbox credit seeding failed for ${account.id}: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }

      await this.audit.record({
        actorStaffId: null,
        actorEmail: email,
        action: "tenant.self_serve_signup",
        targetType: "tenant",
        targetId: account.id,
        summary: `${workspaceName} self-provisioned (sandbox)`,
        reason: "ADR-0002 self-serve sign-up",
        metadata: { workos_organization_id: organization.id },
      });
      return {
        workos_organization_id: organization.id,
        tenant_id: account.id,
        provisioned: true,
      };
    } catch (error) {
      await workos.organizations
        .deleteOrganization(organization.id)
        .catch(() => undefined);
      // Duplicate-callback race: the other request provisioned first — hand back its org.
      const winner = await this.findExisting(request.external_user_id, email);
      if (winner) return { ...winner, provisioned: false };
      throw error;
    }
  }
}

function deriveWorkspaceName(name: string | null, email: string): string {
  const base = name?.trim() || (email.split("@")[0] ?? "workspace");
  return `${base}'s workspace`;
}
