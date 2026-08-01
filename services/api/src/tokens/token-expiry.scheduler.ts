import type { AppDb, ProvisioningDb } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { runtimeRoleEnabled } from "../runtime/runtime-role.js";
import { expireTokenLots } from "./token-expiry.js";

/** Production trigger for expiry/breakage, including inactive workspaces that never hit a lazy read. */
@Injectable()
export class TokenExpiryScheduler {
  private readonly logger = new Logger(TokenExpiryScheduler.name);
  private static readonly LOCK_KEY = 727_008;

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(APP_DB) private readonly appDb: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    return runScheduledTokenExpiry({
      enabled:
        runtimeRoleEnabled(this.config, "scheduler") &&
        this.config.get<string>("MAINTENANCE_CRON_ENABLED") !== "false",
      run: () => this.run(),
      onError: (message) =>
        this.logger.error(`token expiry failed: ${message}`),
    });
  }

  async run(): Promise<{ locked: boolean; expired: number }> {
    // Same shape as the other maintenance jobs (see maintenance.service.ts): skip-if-running via an
    // xact lock that releases with the transaction, provisioner-side discovery, then the mutation
    // per tenant through withTenant.
    return this.provisioning.db.transaction(async (tx) => {
      const locks = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${TokenExpiryScheduler.LOCK_KEY}) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (locks[0]?.locked !== true) return { locked: false, expired: 0 };
      // Unbounded on purpose: a cap with no continuation would drain only one batch per hour and let
      // a backlog outrun the schedule. Served by the partial idx_token_lots_due_for_expiry (0124),
      // so this is near-empty when healthy.
      const tenants = (await tx.execute(
        sql`SELECT DISTINCT tenant_id FROM token_lots
            WHERE expires_at <= now() AND expiry_processed_at IS NULL
            ORDER BY tenant_id`,
      )) as Array<{ tenant_id: string }>;
      let expired = 0;
      for (const tenant of tenants) {
        const tenantId = String(tenant.tenant_id);
        try {
          expired += await this.appDb.withTenant(tenantId, (tenantTx) =>
            expireTokenLots(tenantTx),
          );
        } catch (error) {
          this.logger.error(
            `token expiry tenant ${tenantId} failed: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }
      return { locked: true, expired };
    });
  }
}

/** Extracted cron body: tests drive the same retry-safe caller the decorator invokes in production. */
export async function runScheduledTokenExpiry(input: {
  enabled: boolean;
  run: () => Promise<unknown>;
  onError: (message: string) => void;
}): Promise<void> {
  if (!input.enabled) return;
  try {
    await input.run();
  } catch (error) {
    input.onError(error instanceof Error ? error.message : "unknown");
  }
}
