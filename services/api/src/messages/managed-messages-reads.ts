import {
  type MessageDelivery,
  type MessageDeliverySummary,
  messageDelivery as messageDeliverySchema,
  messageDeliverySummary as messageDeliverySummarySchema,
} from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  type EnvironmentId,
  environments,
  messageDeliveries,
  messageDeliveryAttempts,
  type TenantId,
} from "@app/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { notFound } from "../http/api-error.js";

const LIST_LIMIT = 50;

interface MessageReader {
  get(
    tenantId: string,
    id: string,
    environmentId?: string | null,
  ): Promise<{ to: string }>;
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
  input: { tenantId: string; environmentId: string },
): Promise<MessageDeliverySummary[]> {
  const rows = await db.withTenantDrizzle(input.tenantId, (tx) =>
    selectSummaries(tx)
      .where(
        and(
          eq(messageDeliveries.tenantId, input.tenantId as TenantId),
          eq(
            messageDeliveries.environmentId,
            input.environmentId as EnvironmentId,
          ),
        ),
      )
      .orderBy(desc(messageDeliveries.createdAt))
      .limit(LIST_LIMIT),
  );
  return rows.map(toSummary);
}

/** Full delivery + attempt history; resolves the recipient through the message read (PII-gated). */
export async function retrieveDelivery(
  db: AppDb,
  messages: MessageReader,
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
  const messageId = state.attempts[0]?.messageId;
  const message = messageId
    ? await messages.get(input.tenantId, messageId, input.environmentId)
    : null;
  return messageDeliverySchema.parse({
    ...toSummary(state.delivery),
    recipient: message?.to ?? "redacted",
    attempts: state.attempts.map((attempt) => ({
      id: attempt.id,
      ordinal: attempt.ordinal,
      channel: attempt.channel,
      message_id: attempt.messageId,
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
