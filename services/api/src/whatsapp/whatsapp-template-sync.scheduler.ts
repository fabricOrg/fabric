import type { ProvisioningDb } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { runtimeRoleEnabled } from "../runtime/runtime-role.js";
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";
import { WhatsappTemplateService } from "./whatsapp-template.service.js";
import { parseWabaId } from "./whatsapp-template-cache.js";
import { tenantsForWaba } from "./whatsapp-waba-tenants.js";

@Injectable()
export class WhatsappTemplateSyncScheduler {
  private readonly logger = new Logger(WhatsappTemplateSyncScheduler.name);
  private static readonly LOCK_KEY = 727_009;

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(WhatsappRuntimeService)
    private readonly runtime: WhatsappRuntimeService,
    @Inject(WhatsappTemplateService)
    private readonly templates: WhatsappTemplateService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (
      !runtimeRoleEnabled(this.config, "scheduler") ||
      this.config.get<string>("MAINTENANCE_CRON_ENABLED") === "false"
    ) {
      return;
    }
    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        `whatsapp template sync failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /** Production caller for template cache refresh; the cron tick drives this exact body. */
  async run(input: { tenantIds?: readonly string[] } = {}): Promise<{
    locked: boolean;
    synced: number;
  }> {
    return this.provisioning.db.transaction(async (tx) => {
      const lock = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${WhatsappTemplateSyncScheduler.LOCK_KEY}) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (lock[0]?.locked !== true) return { locked: false, synced: 0 };

      const resolved = await this.runtime.resolve("live");
      const wabaId = parseWabaId(resolved.creds);
      const tenants =
        input.tenantIds ?? (await tenantsForWaba(this.provisioning, wabaId));
      let synced = 0;
      for (const tenantId of tenants) {
        try {
          synced += await this.templates.syncTenant({
            tenantId,
            runtime: resolved,
          });
        } catch (error) {
          this.logger.warn(
            `whatsapp template sync deferred for ${tenantId}: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }
      return { locked: true, synced };
    });
  }
}
