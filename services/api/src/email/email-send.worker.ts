import type { ProvisioningDb } from "@app/db";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import type { Job } from "bullmq";
import { sql } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { QueueService } from "../queue/queue.service.js";
import { EmailService } from "./email.service.js";
import { EMAIL_SEND_QUEUE, type EmailSendJob } from "./email-send.job.js";

@Injectable()
export class EmailSendWorker implements OnModuleInit {
  private readonly logger = new Logger(EmailSendWorker.name);
  private static readonly RECOVERY_LOCK = 727_005;

  constructor(
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.queue.enabled) return;
    this.queue.createWorker(
      EMAIL_SEND_QUEUE,
      async (job: Job<EmailSendJob>) => this.email.process(job.data),
      { concurrency: 5 },
    );
  }

  @Cron("*/30 * * * * *")
  async recoveryTick(): Promise<void> {
    if (
      !this.queue.enabled ||
      this.config.get<string>("MAINTENANCE_CRON_ENABLED") === "false"
    ) {
      return;
    }
    await this.provisioning.db.transaction(async (tx) => {
      const lock = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${EmailSendWorker.RECOVERY_LOCK}) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (lock[0]?.locked !== true) return;
      const tenants = (await tx.execute(
        sql`SELECT DISTINCT tenant_id FROM email_dispatches
            WHERE completed_at IS NULL AND available_at <= now()`,
      )) as Array<{ tenant_id: string }>;
      for (const tenant of tenants) {
        try {
          await this.email.enqueuePending(String(tenant.tenant_id));
        } catch (error) {
          this.logger.warn(
            `email recovery deferred for ${String(tenant.tenant_id)}: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }
    });
  }
}
