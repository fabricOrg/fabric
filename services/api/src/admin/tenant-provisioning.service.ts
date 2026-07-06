import type {
  ProvisionTenantRequest,
  ProvisionTenantResponse,
} from "@app/contracts";
import { accounts, memberships, type ProvisioningDb, users } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import {
  WORKOS_CLIENT,
  type WorkosClientProvider,
} from "../identity/workos-client.provider.js";

/**
 * Ops-provisioned tenant onboarding (docs/PI-3/ORG-PROVISIONING.md):
 *   1) create the WorkOS organization  (external write)
 *   2) insert the accounts row, mapped by workos_organization_id  (slug/org uniqueness = DB constraints)
 *   3) invite the first admin           (external write — sends a real email)
 * If the DB step fails, the WorkOS org is deleted so a failure never orphans an organization.
 */
@Injectable()
export class TenantProvisioningService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(WORKOS_CLIENT) private readonly workosClient: WorkosClientProvider,
  ) {}

  async provision(
    request: ProvisionTenantRequest,
  ): Promise<ProvisionTenantResponse> {
    const workos = this.workosClient();

    const organization = await workos.organizations.createOrganization({
      name: request.name,
    });

    try {
      const adminEmail = request.adminEmail.trim().toLowerCase();
      // Account + the first admin's Fabric invite are written atomically: a pending `invited` user
      // (external_subject_id filled on first login) and an `invited` owner membership. This is what
      // makes the dashboard invite-only — resolve() binds/activates this row and refuses anyone with
      // no membership. Without it, the WorkOS invite alone would grant nothing on the Fabric side.
      const account = await this.provisioning.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(accounts)
          .values({
            name: request.name,
            slug: request.slug,
            plan: request.plan,
            dataRegion: request.dataRegion,
            workosOrganizationId: organization.id,
            status: "active",
          })
          .returning({ id: accounts.id });
        if (!created) throw new Error("Account insert returned no row.");

        // Reuse an existing human if this email was already invited to another org (users.email is
        // unique — one row per person, many memberships).
        await tx
          .insert(users)
          .values({ email: adminEmail, status: "invited" })
          .onConflictDoNothing({ target: users.email });
        const [admin] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, adminEmail))
          .limit(1);
        if (!admin) throw new Error("Admin user upsert returned no row.");

        // Idempotent: re-provisioning the same admin leaves any existing membership untouched.
        await tx
          .insert(memberships)
          .values({
            tenantId: created.id,
            userId: admin.id,
            role: "owner",
            status: "invited",
          })
          .onConflictDoNothing({
            target: [memberships.tenantId, memberships.userId],
          });

        return created;
      });

      await workos.userManagement.sendInvitation({
        email: request.adminEmail,
        organizationId: organization.id,
        roleSlug: "admin",
      });

      return {
        tenant_id: account.id,
        workos_organization_id: organization.id,
        slug: request.slug,
        invited_email: request.adminEmail,
      };
    } catch (error) {
      await workos.organizations
        .deleteOrganization(organization.id)
        .catch(() => undefined);
      throw error;
    }
  }
}
