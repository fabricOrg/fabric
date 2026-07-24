// Wire → typed-surface parsers for the /v1/webhooks resource (split from webhooks.ts for the
// file-length guard). snake_case wire, camelCase SDK surface — same convention as every resource.
import type { WebhookDelivery, WebhookEndpoint } from "./types.js";
import {
  enumField,
  nullableStringField,
  numberField,
  record,
  stringField,
} from "./validation.js";

export function parseEndpoint(data: Record<string, unknown>): WebhookEndpoint {
  const health = record(data.health);
  return {
    id: stringField(data.id, "id"),
    url: stringField(data.url, "url"),
    status: enumField(data.status, ["active", "disabled"] as const, "status"),
    description:
      data.description === null
        ? null
        : stringField(data.description, "description"),
    environment: enumField(data.env, ["sandbox", "live"] as const, "env"),
    secretPrefix: stringField(data.secret_prefix, "secret_prefix"),
    createdAt: stringField(data.created_at, "created_at"),
    health: {
      pending: numberField(health.pending, "health.pending"),
      dead: numberField(health.dead, "health.dead"),
      lastDeliveredAt: nullableStringField(
        health.last_delivered_at,
        "health.last_delivered_at",
      ),
    },
  };
}

export function parseDelivery(data: Record<string, unknown>): WebhookDelivery {
  return {
    id: stringField(data.id, "id"),
    endpointId: stringField(data.endpoint_id, "endpoint_id"),
    eventId: stringField(data.event_id, "event_id"),
    eventType: stringField(data.event_type, "event_type"),
    state: enumField(
      data.state,
      ["pending", "delivering", "delivered", "dead"] as const,
      "state",
    ),
    attempts: numberField(data.attempts, "attempts"),
    nextAttemptAt: stringField(data.next_attempt_at, "next_attempt_at"),
    lastAttemptAt: nullableStringField(data.last_attempt_at, "last_attempt_at"),
    deliveredAt: nullableStringField(data.delivered_at, "delivered_at"),
    lastErrorCategory: nullableStringField(
      data.last_error_category,
      "last_error_category",
    ),
    lastHttpStatus:
      data.last_http_status === null
        ? null
        : numberField(data.last_http_status, "last_http_status"),
    createdAt: stringField(data.created_at, "created_at"),
  };
}
