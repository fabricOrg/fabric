import { accounts, type ProvisioningDb, type TenantId } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { PROVISIONING_DB } from "./provisioning-db.module.js";

/**
 * Tenant liveness for the BFF identity plane. Session resolution itself moved to
 * UserSessionService (ADR-0007 resolve-v2) — this service keeps the tenant-token gate.
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
  ) {}

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
