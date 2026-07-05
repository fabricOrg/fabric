import type {
  ProvisionTenantRequest,
  ProvisionTenantResponse,
} from "@app/contracts";
import { accounts, type ProvisioningDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
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
      const [account] = await this.provisioning.db
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
      if (!account) throw new Error("Account insert returned no row.");

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
