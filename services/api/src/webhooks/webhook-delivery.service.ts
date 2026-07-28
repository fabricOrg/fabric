import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { runtimeRoleEnabled } from "../runtime/runtime-role.js";
import { WebhookDeliveryStore } from "./webhook-delivery.store.js";
import { postWebhook } from "./webhook-http-client.js";

export { publicWebhookEventType } from "./webhook-event-type.js";

export interface DeliverySweepResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly dead: number;
}

/** Durable endpoint-specific outbox worker. Claims commit before any customer network call. */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private ticks = 0;

  constructor(
    @Inject(WebhookDeliveryStore) private readonly store: WebhookDeliveryStore,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (
      !runtimeRoleEnabled(this.config, "scheduler") ||
      this.config.get<string>("MAINTENANCE_CRON_ENABLED") === "false"
    ) {
      return;
    }
    try {
      const result = await this.deliverPending();
      if (result.dead > 0) {
        this.logger.error(
          `webhook delivery sweep produced ${result.dead} dead deliveries`,
        );
      }
      this.ticks += 1;
      if (this.ticks % 5 === 0) await this.logHealth();
    } catch (error) {
      this.logger.error(
        `webhook delivery sweep failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  healthSnapshot() {
    return this.store.healthSnapshot();
  }

  /** Materialize, lease, commit, send, and finalize. Safe for overlapping worker instances. */
  async deliverPending(): Promise<DeliverySweepResult> {
    await this.store.materialize();
    const claims = await this.store.claim();
    const totals = {
      claimed: claims.length,
      delivered: 0,
      retried: 0,
      dead: 0,
    };
    const concurrency = positiveInt(
      this.config.get<string>("WEBHOOK_DELIVERY_CONCURRENCY"),
      10,
    );
    for (let offset = 0; offset < claims.length; offset += concurrency) {
      const slice = claims.slice(offset, offset + concurrency);
      await Promise.all(
        slice.map(async (claim) => {
          const startedAt = new Date();
          const result = await postWebhook({
            url: claim.endpointUrl,
            secret: claim.endpointSecret,
            event: claim.event,
            timeoutMs: 10_000,
            allowPrivateNetworks:
              this.config.get<string>("WEBHOOK_ALLOW_PRIVATE_NETWORKS") ===
              "true",
          });
          totals[await this.store.finalize(claim, startedAt, result)] += 1;
        }),
      );
    }
    return totals;
  }

  private async logHealth(): Promise<void> {
    const health = await this.healthSnapshot();
    this.logger.log(`webhook_delivery_metrics ${JSON.stringify(health)}`);
    if (health.oldestPendingSeconds > 300) {
      this.logger.warn(
        `webhook delivery oldest pending age is ${health.oldestPendingSeconds}s`,
      );
    }
    if (health.retriesLastHour > 100) {
      this.logger.warn(
        `webhook delivery retry volume is ${health.retriesLastHour} in the last hour`,
      );
    }
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
