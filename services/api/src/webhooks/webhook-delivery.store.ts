import { randomUUID } from "node:crypto";
import {
  type OutboxEvent,
  type ProvisioningDb,
  webhookDeliveries,
  webhookDeliveryAttempts,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import type { WebhookPostResult } from "./webhook-http-client.js";

export interface ClaimedWebhookDelivery {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly attempt: number;
  readonly cycleAttempt: number;
  readonly endpointUrl: string;
  readonly endpointSecret: string;
  readonly event: OutboxEvent;
}

@Injectable()
export class WebhookDeliveryStore {
  private static readonly MAX_ATTEMPTS = 10;
  private static readonly BATCH = 100;
  private static readonly MATERIALIZE_BATCH = 1_000;
  private static readonly LEASE_MS = 30_000;

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  async materialize(): Promise<void> {
    await this.provisioning.db.transaction(async (tx) => {
      await tx.execute(sql`
        WITH due AS (
          SELECT o.tenant_id, o.application_id, o.environment_id,
                 o.id AS event_id, e.id AS endpoint_id
          FROM outbox_events o
          JOIN webhook_endpoints e
            ON e.tenant_id = o.tenant_id
            AND e.environment_id = o.environment_id
            AND e.status = 'active'
            AND e.created_at <= o.created_at
          WHERE o.delivered_at IS NULL
            AND o.application_id IS NOT NULL
            AND o.environment_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM webhook_deliveries d
              WHERE d.event_id = o.id AND d.endpoint_id = e.id
            )
          ORDER BY o.created_at, o.id, e.id
          LIMIT ${WebhookDeliveryStore.MATERIALIZE_BATCH}
        )
        INSERT INTO webhook_deliveries (
          tenant_id, application_id, environment_id, event_id, endpoint_id
        )
        SELECT tenant_id, application_id, environment_id, event_id, endpoint_id
        FROM due
        ON CONFLICT (event_id, endpoint_id) DO NOTHING
      `);
      // Endpoints registered after an event must never receive that historical event.
      await tx.execute(sql`
        WITH candidates AS (
          SELECT id FROM outbox_events
          WHERE delivered_at IS NULL
          ORDER BY created_at, id
          LIMIT ${WebhookDeliveryStore.MATERIALIZE_BATCH}
        )
        UPDATE outbox_events o
        SET delivered_at = now(), updated_at = now()
        FROM candidates c
        WHERE o.id = c.id
          AND NOT EXISTS (
            SELECT 1 FROM webhook_deliveries d WHERE d.event_id = o.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM webhook_endpoints e
            WHERE e.tenant_id = o.tenant_id
              AND e.environment_id = o.environment_id
              AND e.status = 'active'
              AND e.created_at <= o.created_at
          )
      `);
    });
  }

  async claim(): Promise<ClaimedWebhookDelivery[]> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + WebhookDeliveryStore.LEASE_MS);
    return this.provisioning.db.transaction(async (tx) => {
      await tx.execute(sql`
        WITH due AS (
          SELECT d.id
          FROM webhook_deliveries d
          JOIN webhook_endpoints e ON e.id = d.endpoint_id
          WHERE e.status = 'active'
            AND (
              (d.state = 'pending' AND d.next_attempt_at <= now())
              OR (d.state = 'delivering' AND d.lease_expires_at <= now())
            )
          ORDER BY d.next_attempt_at, d.created_at
          FOR UPDATE OF d SKIP LOCKED
          LIMIT ${WebhookDeliveryStore.BATCH}
        )
        UPDATE webhook_deliveries d
        SET state = 'delivering', attempts = attempts + 1,
            cycle_attempts = cycle_attempts + 1,
            lease_token = ${leaseToken}::uuid,
            lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
            last_attempt_at = now(), updated_at = now()
        FROM due
        WHERE d.id = due.id
      `);
      const rows = (await tx.execute(sql`
        SELECT d.id AS delivery_id, d.lease_token, d.attempts, d.cycle_attempts,
               e.url, e.secret,
               o.id AS event_id, o.tenant_id, o.application_id, o.environment_id,
               o.event_type, o.payload, o.delivered_at AS event_delivered_at,
               o.attempts AS event_attempts, o.created_at AS event_created_at,
               o.updated_at AS event_updated_at
        FROM webhook_deliveries d
        JOIN webhook_endpoints e ON e.id = d.endpoint_id
        JOIN outbox_events o ON o.id = d.event_id
        WHERE d.lease_token = ${leaseToken}::uuid AND d.state = 'delivering'
      `)) as unknown as Array<Record<string, unknown>>;
      return rows.map(toClaim);
    });
  }

  async finalize(
    claim: ClaimedWebhookDelivery,
    startedAt: Date,
    result: WebhookPostResult,
  ): Promise<"delivered" | "retried" | "dead"> {
    const isDead =
      !result.ok && claim.cycleAttempt >= WebhookDeliveryStore.MAX_ATTEMPTS;
    const state = result.ok ? "delivered" : isDead ? "dead" : "pending";
    const outcome = result.ok ? "delivered" : isDead ? "dead" : "retry";
    const completedAt = new Date();
    const nextAttemptAt = new Date(
      completedAt.getTime() + retryDelayMs(claim.deliveryId, claim.attempt),
    );
    await this.provisioning.db.transaction(async (tx) => {
      await tx
        .insert(webhookDeliveryAttempts)
        .values({
          tenantId: claim.event.tenantId,
          deliveryId: claim.deliveryId,
          attemptNumber: claim.attempt,
          outcome,
          httpStatus: result.httpStatus,
          errorCategory: result.ok ? null : result.errorCategory,
          startedAt,
          completedAt,
        })
        .onConflictDoNothing();
      const updated = await tx
        .update(webhookDeliveries)
        .set({
          state,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt,
          deliveredAt: result.ok ? completedAt : null,
          lastHttpStatus: result.httpStatus,
          lastErrorCategory: result.ok ? null : result.errorCategory,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(webhookDeliveries.id, claim.deliveryId),
            eq(webhookDeliveries.leaseToken, claim.leaseToken),
          ),
        )
        .returning({ id: webhookDeliveries.id });
      if (updated.length === 0) return;
      await tx.execute(sql`
        UPDATE outbox_events o
        SET delivered_at = now(), updated_at = now()
        WHERE o.id = ${claim.event.id}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM webhook_deliveries d
            WHERE d.event_id = o.id AND d.state IN ('pending', 'delivering')
          )
      `);
    });
    if (outcome === "retry") return "retried";
    return outcome;
  }

  async healthSnapshot(): Promise<{
    pending: number;
    dead: number;
    retriesLastHour: number;
    oldestPendingSeconds: number;
  }> {
    const rows = (await this.provisioning.db.execute(sql`
      SELECT count(*) FILTER (WHERE state IN ('pending', 'delivering'))::int AS pending,
        count(*) FILTER (WHERE state = 'dead')::int AS dead,
        count(*) FILTER (
          WHERE attempts > 1 AND last_attempt_at >= now() - interval '1 hour'
        )::int AS retries_last_hour,
        coalesce(extract(epoch FROM now() - min(created_at) FILTER (
          WHERE state IN ('pending', 'delivering')
        )), 0)::int AS oldest_pending_seconds
      FROM webhook_deliveries
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0] ?? {};
    return {
      pending: Number(row.pending ?? 0),
      dead: Number(row.dead ?? 0),
      retriesLastHour: Number(row.retries_last_hour ?? 0),
      oldestPendingSeconds: Number(row.oldest_pending_seconds ?? 0),
    };
  }
}

function retryDelayMs(deliveryId: string, attempt: number): number {
  const exponential = Math.min(
    60_000 * 2 ** Math.max(0, attempt - 1),
    21_600_000,
  );
  const jitter =
    Number.parseInt(deliveryId.replaceAll("-", "").slice(-4), 16) % 30_000;
  return exponential + jitter;
}

function toClaim(row: Record<string, unknown>): ClaimedWebhookDelivery {
  return {
    deliveryId: String(row.delivery_id),
    leaseToken: String(row.lease_token),
    attempt: Number(row.attempts),
    cycleAttempt: Number(row.cycle_attempts),
    endpointUrl: String(row.url),
    endpointSecret: String(row.secret),
    event: {
      id: String(row.event_id),
      tenantId: String(row.tenant_id) as OutboxEvent["tenantId"],
      applicationId: String(row.application_id) as OutboxEvent["applicationId"],
      environmentId: String(row.environment_id) as OutboxEvent["environmentId"],
      eventType: String(row.event_type),
      payload: row.payload,
      deliveredAt: (row.event_delivered_at as Date | null) ?? null,
      attempts: Number(row.event_attempts),
      createdAt: new Date(String(row.event_created_at)),
      updatedAt: new Date(String(row.event_updated_at)),
    },
  };
}
