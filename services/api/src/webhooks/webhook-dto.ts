import type { WebhookDeliveryDto, WebhookEndpointDto } from "@app/contracts";
import type { WebhookDelivery, WebhookEndpoint } from "@app/db";

export function emptyHealth(): WebhookEndpointDto["health"] {
  return { pending: 0, dead: 0, last_delivered_at: null };
}

export function toEndpointDto(
  row: WebhookEndpoint,
  env: "sandbox" | "live",
  health: WebhookEndpointDto["health"],
): WebhookEndpointDto {
  return {
    id: row.id,
    url: row.url,
    status: row.status === "disabled" ? "disabled" : "active",
    description: row.description,
    env,
    secret_prefix: `${row.secret.slice(0, 10)}…`,
    created_at: row.createdAt.toISOString(),
    health,
  };
}

export function toDeliveryDto(
  row: WebhookDelivery,
  eventType: string,
): WebhookDeliveryDto {
  const state =
    row.state === "delivering" ||
    row.state === "delivered" ||
    row.state === "dead"
      ? row.state
      : "pending";
  return {
    id: row.id,
    endpoint_id: row.endpointId,
    event_id: row.eventId,
    event_type: eventType,
    state,
    attempts: row.attempts,
    next_attempt_at: row.nextAttemptAt.toISOString(),
    last_attempt_at: row.lastAttemptAt?.toISOString() ?? null,
    delivered_at: row.deliveredAt?.toISOString() ?? null,
    last_error_category: row.lastErrorCategory,
    last_http_status: row.lastHttpStatus,
    created_at: row.createdAt.toISOString(),
  };
}
