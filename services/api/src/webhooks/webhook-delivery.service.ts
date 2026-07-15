import { createHmac } from "node:crypto";
import { outboxEvents, type ProvisioningDb, webhookEndpoints } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";

/**
 * OUTBOX → WEBHOOK DELIVERY (finding 8). Every minute: sweep undelivered outbox rows (partial
 * index — cheap forever), POST each to the owning tenant's ACTIVE endpoints with an HMAC
 * signature, mark delivered when every endpoint acked 2xx. Non-2xx/network → attempts++ and the
 * next sweep retries (at-least-once semantics; consumers de-dupe on event id). Attempts cap at
 * MAX_ATTEMPTS → the row is marked dead (delivered_at set, error logged) so the sweep can't
 * grind forever on a broken endpoint.
 *
 * Runs on the provisioner connection (cross-tenant read of events+endpoints, UPDATE of delivery
 * bookkeeping — scoped policies in 0032). Advisory xact lock → overlapping sweeps no-op.
 *
 * Signature (Stripe-style): `fabric-signature: t=<unix>,v1=<hex hmac_sha256(secret, `${t}.${body}`)>`.
 * The timestamp binds the signature to a ~replay window the consumer enforces.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private static readonly LOCK_KEY = 727_003;
  private static readonly MAX_ATTEMPTS = 10;
  private static readonly BATCH = 100;

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private cronEnabled(): boolean {
    return this.config.get<string>("MAINTENANCE_CRON_ENABLED") !== "false";
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.cronEnabled()) return;
    try {
      await this.deliverPending();
    } catch (error) {
      this.logger.error(
        `webhook delivery sweep failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /** One sweep (also the test entry point). Returns per-event outcomes for assertions. */
  async deliverPending(): Promise<{
    locked: boolean;
    delivered: number;
    retried: number;
    dead: number;
  }> {
    return this.provisioning.db.transaction(async (tx) => {
      const lockRows = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${WebhookDeliveryService.LOCK_KEY}) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (lockRows[0]?.locked !== true) {
        return { locked: false, delivered: 0, retried: 0, dead: 0 };
      }

      const pending = await tx
        .select()
        .from(outboxEvents)
        .where(
          and(
            isNull(outboxEvents.deliveredAt),
            lt(outboxEvents.attempts, WebhookDeliveryService.MAX_ATTEMPTS),
          ),
        )
        .orderBy(asc(outboxEvents.createdAt))
        .limit(WebhookDeliveryService.BATCH);

      let delivered = 0;
      let retried = 0;
      let dead = 0;
      for (const event of pending) {
        const endpoints = event.environmentId
          ? await tx
              .select()
              .from(webhookEndpoints)
              .where(
                and(
                  eq(webhookEndpoints.tenantId, event.tenantId),
                  eq(webhookEndpoints.environmentId, event.environmentId),
                  eq(webhookEndpoints.status, "active"),
                ),
              )
          : [];
        // No endpoints registered → nothing to fan out; mark delivered so the row retires.
        const allAcked =
          endpoints.length === 0
            ? true
            : (
                await Promise.all(
                  endpoints.map((e) => this.post(e.url, e.secret, event)),
                )
              ).every(Boolean);

        if (allAcked) {
          await tx
            .update(outboxEvents)
            .set({ deliveredAt: new Date(), updatedAt: new Date() })
            .where(eq(outboxEvents.id, event.id));
          delivered++;
        } else {
          const attempts = event.attempts + 1;
          const isDead = attempts >= WebhookDeliveryService.MAX_ATTEMPTS;
          await tx
            .update(outboxEvents)
            .set({
              attempts,
              // Dead-letter: retire the row so a permanently broken endpoint can't grind the
              // sweep forever. The error log is the operator's signal.
              ...(isDead ? { deliveredAt: new Date() } : {}),
              updatedAt: new Date(),
            })
            .where(eq(outboxEvents.id, event.id));
          if (isDead) {
            dead++;
            this.logger.error(
              `webhook event ${event.id} (${event.eventType}) DEAD after ${attempts} attempts`,
            );
          } else {
            retried++;
          }
        }
      }
      return { locked: true, delivered, retried, dead };
    });
  }

  /** Signed POST; true on 2xx. Never throws — a delivery fault is a retry, not a crash. */
  private async post(
    url: string,
    secret: string,
    event: { id: string; eventType: string; payload: unknown; createdAt: Date },
  ): Promise<boolean> {
    const body = JSON.stringify({
      id: event.id,
      type: publicWebhookEventType(event.eventType, event.payload),
      created_at: event.createdAt.toISOString(),
      data: event.payload,
    });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret)
      .update(`${t}.${body}`)
      .digest("hex");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "fabric-signature": `t=${t},v1=${v1}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/** Internal transition names stay private; public consumers receive the stable direct-event vocabulary. */
export function publicWebhookEventType(
  eventType: string,
  payload: unknown,
): string {
  if (eventType === "message.created") return "message.sent";
  if (eventType === "message.received") return "message.inbound";
  if (eventType !== "message.updated") return eventType;

  const status =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).status
      : undefined;
  if (status === "delivered") return "message.delivered";
  if (status === "undelivered") return "message.undelivered";
  if (status === "failed" || status === "expired") return "message.failed";
  return "message.sent";
}
