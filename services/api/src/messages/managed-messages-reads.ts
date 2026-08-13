import {
  type MessageDelivery,
  type MessageDeliverySummary,
  type MessageDeliveryWebhookStatus,
  messageDelivery as messageDeliverySchema,
  messageDeliverySummary as messageDeliverySummarySchema,
  messageDeliveryWebhookStatus as messageDeliveryWebhookStatusSchema,
} from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  type EnvironmentId,
  environments,
  messageDeliveries,
  messageDeliveryAttempts,
  outboxEvents,
  type TenantId,
  webhookDeliveries,
  webhookEndpoints,
} from "@app/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { notFound } from "../http/api-error.js";
import {
  CURSOR_TS_FORMAT,
  encodeCursor,
  type PageInput,
} from "../http/cursor.js";

interface MessageReader {
  get(
    tenantId: string,
    id: string,
    environmentId?: string | null,
  ): Promise<{ to: string }>;
}

interface DeliveryReaders {
  sms: MessageReader;
  email: MessageReader;
  whatsapp: MessageReader;
}

const summaryColumns = {
  id: messageDeliveries.id,
  key: messageDeliveries.key,
  versionId: messageDeliveries.versionId,
  locale: messageDeliveries.locale,
  channel: messageDeliveries.channel,
  status: messageDeliveries.status,
  resourceVersion: messageDeliveries.resourceVersion,
  reference: messageDeliveries.reference,
  metadata: messageDeliveries.metadata,
  currency: messageDeliveries.currency,
  totalCostMinor: messageDeliveries.totalCostMinor,
  createdAt: messageDeliveries.createdAt,
  updatedAt: messageDeliveries.updatedAt,
  environment: environments.type,
  cursorTs: sql<string>`to_char(${messageDeliveries.createdAt} at time zone 'UTC', ${CURSOR_TS_FORMAT})`,
};

type SummaryRow =
  Awaited<ReturnType<typeof selectSummaries>> extends Array<infer Row>
    ? Row
    : never;

function selectSummaries(
  tx: Parameters<Parameters<AppDb["withTenantDrizzle"]>[1]>[0],
) {
  return tx
    .select(summaryColumns)
    .from(messageDeliveries)
    .innerJoin(
      environments,
      eq(environments.id, messageDeliveries.environmentId),
    )
    .$dynamic();
}

function toSummary(row: SummaryRow): MessageDeliverySummary {
  return messageDeliverySummarySchema.parse({
    id: row.id,
    key: row.key,
    version_id: row.versionId,
    environment: row.environment,
    locale: row.locale,
    channel: row.channel,
    status: row.status,
    resource_version: row.resourceVersion,
    reference: row.reference,
    metadata: row.metadata,
    cost: { minor: row.totalCostMinor.toString(), currency: row.currency },
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

/** Recent deliveries for one environment, newest first. Summary rows only — no recipient (PII). */
export async function listDeliveries(
  db: AppDb,
  input: { tenantId: string; environmentId: string; page: PageInput },
): Promise<{
  deliveries: MessageDeliverySummary[];
  next_cursor: string | null;
}> {
  const rows = await db.withTenantDrizzle(input.tenantId, (tx) =>
    selectSummaries(tx)
      .where(
        and(
          eq(messageDeliveries.tenantId, input.tenantId as TenantId),
          eq(
            messageDeliveries.environmentId,
            input.environmentId as EnvironmentId,
          ),
          input.page.before
            ? sql`(${messageDeliveries.createdAt}, ${messageDeliveries.id}) < (${input.page.before.createdAt}::text::timestamptz, ${input.page.before.id})`
            : undefined,
        ),
      )
      .orderBy(desc(messageDeliveries.createdAt), desc(messageDeliveries.id))
      .limit(input.page.limit + 1),
  );
  const hasMore = rows.length > input.page.limit;
  const visible = hasMore ? rows.slice(0, input.page.limit) : rows;
  const last = visible[visible.length - 1];
  return {
    deliveries: visible.map(toSummary),
    next_cursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.cursorTs, id: last.id })
        : null,
  };
}

/** Full delivery + attempt history; resolves the recipient through the message read (PII-gated). */
export async function retrieveDelivery(
  db: AppDb,
  readers: DeliveryReaders,
  input: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
    deliveryId: string;
  },
): Promise<MessageDelivery> {
  const state = await db.withTenantDrizzle(input.tenantId, async (tx) => {
    const [delivery] = await selectSummaries(tx)
      .where(
        and(
          eq(messageDeliveries.tenantId, input.tenantId as TenantId),
          eq(
            messageDeliveries.applicationId,
            input.applicationId as ApplicationId,
          ),
          eq(
            messageDeliveries.environmentId,
            input.environmentId as EnvironmentId,
          ),
          eq(messageDeliveries.id, input.deliveryId),
        ),
      )
      .limit(1);
    if (!delivery) {
      throw notFound(
        "message_delivery_not_found",
        "No managed delivery with that id.",
      );
    }
    const attempts = await tx
      .select()
      .from(messageDeliveryAttempts)
      .where(eq(messageDeliveryAttempts.deliveryId, input.deliveryId))
      .orderBy(asc(messageDeliveryAttempts.ordinal));
    return { delivery, attempts };
  });
  const firstAttempt = state.attempts[0];
  // Keyed by channel rather than an email-vs-else ternary: under that shape a whatsapp delivery read
  // the SMS reference with the SMS reader and 404'd, or worse, resolved a foreign row.
  const channel = state.delivery.channel as keyof DeliveryReaders;
  const references: Record<keyof DeliveryReaders, string | null | undefined> = {
    sms: firstAttempt?.messageId,
    email: firstAttempt?.emailMessageId,
    whatsapp: firstAttempt?.whatsappMessageId,
  };
  const reader = readers[channel];
  const channelMessageId = references[channel];
  const message =
    channelMessageId && reader
      ? await reader.get(input.tenantId, channelMessageId, input.environmentId)
      : null;
  return messageDeliverySchema.parse({
    ...toSummary(state.delivery),
    recipient: message?.to ?? "redacted",
    attempts: state.attempts.map((attempt) => ({
      id: attempt.id,
      ordinal: attempt.ordinal,
      channel: attempt.channel,
      // The public `message_id` is the SMS message resource id. Email and WhatsApp attempts expose
      // theirs through their own channel resources, not this field.
      message_id: attempt.channel === "sms" ? attempt.messageId : null,
      status: attempt.status,
      cost: {
        minor: attempt.costMinor.toString(),
        currency: attempt.currency,
      },
      error_code: attempt.errorCode,
      created_at: attempt.createdAt.toISOString(),
      updated_at: attempt.updatedAt.toISOString(),
    })),
  });
}

/**
 * Webhook fan-out status for one delivery: every webhook_deliveries row whose outbox event
 * belongs to this delivery. Managed sends reuse the delivery id as the message id, so the
 * payload's message_id matches both the acceptance and every transition event. The delivery must
 * exist in the requested app/env (containment) — 404 otherwise, same as the detail read.
 */
export async function listDeliveryWebhookStatus(
  db: AppDb,
  input: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
    deliveryId: string;
  },
): Promise<MessageDeliveryWebhookStatus[]> {
  const rows = await db.withTenantDrizzle(input.tenantId, async (tx) => {
    const [delivery] = await tx
      .select({ id: messageDeliveries.id })
      .from(messageDeliveries)
      .where(
        and(
          eq(messageDeliveries.tenantId, input.tenantId as TenantId),
          eq(
            messageDeliveries.applicationId,
            input.applicationId as ApplicationId,
          ),
          eq(
            messageDeliveries.environmentId,
            input.environmentId as EnvironmentId,
          ),
          eq(messageDeliveries.id, input.deliveryId),
        ),
      )
      .limit(1);
    if (!delivery) {
      throw notFound(
        "message_delivery_not_found",
        "No managed delivery with that id.",
      );
    }
    return tx
      .select({
        eventId: outboxEvents.id,
        eventType: outboxEvents.eventType,
        endpointId: webhookEndpoints.id,
        endpointUrl: webhookEndpoints.url,
        state: webhookDeliveries.state,
        attempts: webhookDeliveries.attempts,
        lastHttpStatus: webhookDeliveries.lastHttpStatus,
        lastErrorCategory: webhookDeliveries.lastErrorCategory,
        deliveredAt: webhookDeliveries.deliveredAt,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .innerJoin(outboxEvents, eq(outboxEvents.id, webhookDeliveries.eventId))
      .innerJoin(
        webhookEndpoints,
        eq(webhookEndpoints.id, webhookDeliveries.endpointId),
      )
      .where(
        and(
          eq(webhookDeliveries.tenantId, input.tenantId as TenantId),
          sql`${outboxEvents.payload}->>'message_id' = ${input.deliveryId}`,
        ),
      )
      .orderBy(asc(webhookDeliveries.createdAt));
  });
  return rows.map((row) =>
    messageDeliveryWebhookStatusSchema.parse({
      event_id: row.eventId,
      event_type: row.eventType,
      endpoint_id: row.endpointId,
      endpoint_url: row.endpointUrl,
      state: row.state,
      attempts: row.attempts,
      last_http_status: row.lastHttpStatus,
      last_error_category: row.lastErrorCategory,
      delivered_at: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
    }),
  );
}
