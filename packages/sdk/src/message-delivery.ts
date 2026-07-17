import type {
  MessageDelivery,
  MessageDeliveryAttempt,
  Money,
} from "./types.js";
import {
  ApiShapeError,
  enumField,
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
    channel: enumField(data.channel, ["sms"] as const, "channel"),
    status: enumField(data.status, DELIVERY_STATUSES, "status"),
    resourceVersion: numberField(data.resource_version, "resource_version"),
    recipient: stringField(data.recipient, "recipient"),
    reference: typeof data.reference === "string" ? data.reference : null,
    metadata: parseMetadata(data.metadata),
    cost: parseMoney(data.cost, "cost"),
    attempts: data.attempts.map((value) => parseAttempt(record(value))),
    createdAt: stringField(data.created_at, "created_at"),
    updatedAt: stringField(data.updated_at, "updated_at"),
  };
}

function parseAttempt(data: Record<string, unknown>): MessageDeliveryAttempt {
  return {
    id: stringField(data.id, "attempts.id"),
    ordinal: numberField(data.ordinal, "attempts.ordinal"),
    channel: enumField(data.channel, ["sms"] as const, "attempts.channel"),
    messageId: typeof data.message_id === "string" ? data.message_id : null,
    status: enumField(data.status, DELIVERY_STATUSES, "attempts.status"),
    cost: parseMoney(data.cost, "attempts.cost"),
    errorCode: typeof data.error_code === "string" ? data.error_code : null,
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
