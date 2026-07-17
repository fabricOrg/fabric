import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError } from "./errors.js";
import type { Transport } from "./transport.js";
import type {
  FabricResponse,
  RequestOptions,
  WebhookDelivery,
  WebhookEndpoint,
  WriteOptions,
} from "./types.js";
import {
  enumField,
  numberField,
  record,
  requireNonEmpty,
  stringField,
} from "./validation.js";
import { parseWebhookEvent, type WebhookEvent } from "./webhook-events.js";

export interface CreateWebhookParams {
  readonly url: string;
  readonly description?: string;
  readonly applicationId?: string;
  readonly environment?: "sandbox" | "live";
}
export interface CreatedWebhookEndpoint extends WebhookEndpoint {
  readonly secret: string;
}
export interface ListWebhookDeliveriesParams {
  readonly state?: "pending" | "delivering" | "delivered" | "dead";
}
export interface VerifyWebhookParams {
  readonly payload: string | Uint8Array;
  readonly signature: string | string[] | undefined;
  readonly secret: string;
  readonly tolerance?: number;
  readonly now?: Date;
}
export class WebhooksResource {
  constructor(private readonly transport: Transport) {}

  async create(
    params: CreateWebhookParams,
    options?: WriteOptions,
  ): Promise<FabricResponse<CreatedWebhookEndpoint>> {
    requireNonEmpty(params.url, "url");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/webhooks",
      body: {
        url: params.url,
        ...(params.description ? { description: params.description } : {}),
        ...(params.applicationId
          ? { application_id: params.applicationId }
          : {}),
        ...(params.environment ? { env: params.environment } : {}),
      },
      ...(options ? { options } : {}),
    });
    return {
      ...response,
      data: {
        ...parseEndpoint(response.data),
        secret: stringField(response.data.secret, "secret"),
      },
    };
  }

  async list(
    applicationId?: string,
    options?: RequestOptions,
  ): Promise<FabricResponse<ReadonlyArray<WebhookEndpoint>>> {
    const query = applicationId
      ? `?applicationId=${encodeURIComponent(applicationId)}`
      : "";
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/v1/webhooks${query}`,
      ...(options ? { options } : {}),
    });
    if (!Array.isArray(response.data.endpoints))
      throw new TypeError("Fabric returned an invalid webhook list.");
    return {
      ...response,
      data: response.data.endpoints.map((item) => parseEndpoint(record(item))),
    };
  }

  async remove(
    id: string,
    options?: WriteOptions,
  ): Promise<FabricResponse<void>> {
    requireNonEmpty(id, "id");
    return this.transport.request<void>({
      method: "DELETE",
      path: `/v1/webhooks/${encodeURIComponent(id)}`,
      ...(options ? { options } : {}),
    });
  }

  /** Disable an endpoint without deleting its delivery history. */
  async disable(
    id: string,
    options?: WriteOptions,
  ): Promise<FabricResponse<void>> {
    return this.remove(id, options);
  }

  async listDeliveries(
    endpointId: string,
    params: ListWebhookDeliveriesParams = {},
    options?: RequestOptions,
  ): Promise<FabricResponse<ReadonlyArray<WebhookDelivery>>> {
    requireNonEmpty(endpointId, "endpointId");
    const query = params.state ? `?state=${params.state}` : "";
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/v1/webhooks/${encodeURIComponent(endpointId)}/deliveries${query}`,
      ...(options ? { options } : {}),
    });
    if (!Array.isArray(response.data.deliveries)) {
      throw new TypeError("Fabric returned an invalid webhook delivery list.");
    }
    return {
      ...response,
      data: response.data.deliveries.map((item) => parseDelivery(record(item))),
    };
  }

  async replayDelivery(
    endpointId: string,
    deliveryId: string,
    options?: WriteOptions,
  ): Promise<FabricResponse<WebhookDelivery>> {
    requireNonEmpty(endpointId, "endpointId");
    requireNonEmpty(deliveryId, "deliveryId");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: `/v1/webhooks/${encodeURIComponent(endpointId)}/deliveries/${encodeURIComponent(deliveryId)}/replay`,
      ...(options ? { options } : {}),
    });
    return { ...response, data: parseDelivery(record(response.data.delivery)) };
  }

  verify(params: VerifyWebhookParams): WebhookEvent {
    const signature = Array.isArray(params.signature)
      ? params.signature[0]
      : params.signature;
    if (!signature)
      throw verificationError(
        "The `fabric-signature` header is required.",
        "missing_signature",
      );
    if (params.secret.trim().length === 0) {
      throw verificationError(
        "The webhook secret is required.",
        "missing_secret",
      );
    }
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signature);
    if (!match?.[1] || !match[2])
      throw verificationError(
        "The webhook signature header is malformed.",
        "invalid_signature_format",
      );
    const timestamp = Number(match[1]);
    const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000);
    const tolerance = params.tolerance ?? 300;
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw verificationError(
        "The webhook tolerance must be a non-negative number of seconds.",
        "invalid_tolerance",
      );
    }
    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(nowSeconds - timestamp) > tolerance
    ) {
      throw verificationError(
        "The webhook timestamp is outside the allowed tolerance.",
        "stale_webhook",
      );
    }
    const raw =
      typeof params.payload === "string"
        ? params.payload
        : new TextDecoder().decode(params.payload);
    const expected = createHmac("sha256", params.secret)
      .update(`${timestamp}.${raw}`)
      .digest();
    const received = Buffer.from(match[2], "hex");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw verificationError(
        "The webhook signature is invalid.",
        "invalid_signature",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (cause) {
      throw new WebhookVerificationError(
        "The verified webhook payload is not valid JSON.",
        { code: "invalid_payload", cause },
      );
    }
    return parseWebhookEvent(parsed);
  }
}

function parseEndpoint(data: Record<string, unknown>): WebhookEndpoint {
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
      lastDeliveredAt: nullableString(
        health.last_delivered_at,
        "health.last_delivered_at",
      ),
    },
  };
}

function parseDelivery(data: Record<string, unknown>): WebhookDelivery {
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
    lastAttemptAt: nullableString(data.last_attempt_at, "last_attempt_at"),
    deliveredAt: nullableString(data.delivered_at, "delivered_at"),
    lastErrorCategory: nullableString(
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

function nullableString(value: unknown, name: string): string | null {
  return value === null ? null : stringField(value, name);
}

function verificationError(
  message: string,
  code: string,
): WebhookVerificationError {
  return new WebhookVerificationError(message, { code });
}
