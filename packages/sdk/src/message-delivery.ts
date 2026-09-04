import type {
  MessageDelivery,
  MessageDeliveryAttempt,
  MessageDeliverySummary,
  MessageDeliveryWebhookStatus,
  Money,
} from "./types.js";
import {
  ApiShapeError,
  enumField,
  nullableStringField,
  numberField,
  record,
  stringField,
} from "./validation.js";

const DELIVERY_STATUSES = [
  "accepted",
  "processing",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "expired",
] as const;

/** Parses the wire shape of a managed delivery into the SDK's camelCase contract. */
export function parseMessageDelivery(
  data: Record<string, unknown>,
): MessageDelivery {
  if (!Array.isArray(data.attempts)) throw new ApiShapeError("attempts");
  return {
    id: stringField(data.id, "id"),
    key: stringField(data.key, "key"),
    versionId: stringField(data.version_id, "version_id"),
    environment: enumField(
      data.environment,
      ["sandbox", "live"] as const,
      "environment",
    ),
    locale: stringField(data.locale, "locale"),
    channel: enumField(
      data.channel,
      ["sms", "email", "whatsapp"] as const,
      "channel",
    ),
    status: enumField(data.status, DELIVERY_STATUSES, "status"),
    resourceVersion: numberField(data.resource_version, "resource_version"),
    recipient: stringField(data.recipient, "recipient"),
    reference: nullableStringField(data.reference, "reference"),
    metadata: parseMetadata(data.metadata),
    cost: parseMoney(data.cost, "cost"),
    attempts: data.attempts.map((value) => parseAttempt(record(value))),
    createdAt: stringField(data.created_at, "created_at"),
    updatedAt: stringField(data.updated_at, "updated_at"),
  };
}

/** Parses the reduced wire shape returned by the managed-delivery list endpoint. */
export function parseMessageDeliverySummary(
  data: Record<string, unknown>,
): MessageDeliverySummary {
  return {
    id: stringField(data.id, "id"),
    key: stringField(data.key, "key"),
    versionId: stringField(data.version_id, "version_id"),
    environment: enumField(
      data.environment,
      ["sandbox", "live"] as const,
      "environment",
    ),
    locale: stringField(data.locale, "locale"),
    channel: enumField(
      data.channel,
      ["sms", "email", "whatsapp"] as const,
      "channel",
    ),
    status: enumField(data.status, DELIVERY_STATUSES, "status"),
    resourceVersion: numberField(data.resource_version, "resource_version"),
    reference: nullableStringField(data.reference, "reference"),
    metadata: parseMetadata(data.metadata),
    cost: parseMoney(data.cost, "cost"),
    createdAt: stringField(data.created_at, "created_at"),
    updatedAt: stringField(data.updated_at, "updated_at"),
  };
}

/** Parses webhook observability for one event/endpoint fan-out row. */
export function parseMessageDeliveryWebhookStatus(
  data: Record<string, unknown>,
): MessageDeliveryWebhookStatus {
  return {
    eventId: stringField(data.event_id, "event_id"),
    eventType: stringField(data.event_type, "event_type"),
    endpointId: stringField(data.endpoint_id, "endpoint_id"),
    endpointUrl: stringField(data.endpoint_url, "endpoint_url"),
    state: enumField(
      data.state,
      ["pending", "delivering", "delivered", "dead"] as const,
      "state",
    ),
    attempts: numberField(data.attempts, "attempts"),
    lastHttpStatus:
      data.last_http_status === null
        ? null
        : numberField(data.last_http_status, "last_http_status"),
    lastErrorCategory: nullableStringField(
      data.last_error_category,
      "last_error_category",
    ),
    deliveredAt: nullableStringField(data.delivered_at, "delivered_at"),
    createdAt: stringField(data.created_at, "created_at"),
  };
}

function parseAttempt(data: Record<string, unknown>): MessageDeliveryAttempt {
  return {
    id: stringField(data.id, "attempts.id"),
    ordinal: numberField(data.ordinal, "attempts.ordinal"),
    channel: enumField(
      data.channel,
      ["sms", "email", "whatsapp"] as const,
      "attempts.channel",
    ),
    messageId: nullableStringField(data.message_id, "attempts.message_id"),
    status: enumField(data.status, DELIVERY_STATUSES, "attempts.status"),
    cost: parseMoney(data.cost, "attempts.cost"),
    errorCode: nullableStringField(data.error_code, "attempts.error_code"),
    createdAt: stringField(data.created_at, "attempts.created_at"),
    updatedAt: stringField(data.updated_at, "attempts.updated_at"),
  };
}

function parseMoney(value: unknown, path: string): Money {
  const cost = record(value);
  return {
    minor: stringField(cost.minor, `${path}.minor`),
    currency: enumField(
      cost.currency,
      ["GHS", "NGN", "USD"] as const,
      `${path}.currency`,
    ),
  };
}

function parseMetadata(
  value: unknown,
): Readonly<Record<string, string | number | boolean>> {
  const raw = record(value ?? {});
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(raw)) {
    if (
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    ) {
      throw new ApiShapeError(`metadata.${key}`);
    }
    metadata[key] = item;
  }
  return metadata;
}
