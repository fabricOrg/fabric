import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError } from "./errors.js";
import type { Transport } from "./transport.js";
import type {
  FabricResponse,
  RequestOptions,
  WebhookEndpoint,
} from "./types.js";
import {
  enumField,
  record,
  requireNonEmpty,
  stringField,
} from "./validation.js";

export interface CreateWebhookParams {
  readonly url: string;
  readonly description?: string;
  readonly applicationId?: string;
  readonly environment?: "sandbox" | "live";
}
export interface CreatedWebhookEndpoint extends WebhookEndpoint {
  readonly secret: string;
}
export interface VerifyWebhookParams {
  readonly payload: string | Uint8Array;
  readonly signature: string | string[] | undefined;
  readonly secret: string;
  readonly tolerance?: number;
  readonly now?: Date;
}
export interface WebhookEvent<T = unknown> {
  readonly id?: string;
  readonly type: string;
  readonly createdAt?: string;
  readonly data: T;
}

export class WebhooksResource {
  constructor(private readonly transport: Transport) {}

  async create(
    params: CreateWebhookParams,
    options?: RequestOptions,
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
    options?: RequestOptions,
  ): Promise<FabricResponse<void>> {
    requireNonEmpty(id, "id");
    return this.transport.request<void>({
      method: "DELETE",
      path: `/v1/webhooks/${encodeURIComponent(id)}`,
      ...(options ? { options } : {}),
    });
  }

  verify<T = unknown>(params: VerifyWebhookParams): WebhookEvent<T> {
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
    const event = record(parsed);
    return {
      type: typeof event.type === "string" ? event.type : "unknown",
      data: (event.data ?? event) as T,
      ...(typeof event.id === "string" ? { id: event.id } : {}),
      ...(typeof event.created_at === "string"
        ? { createdAt: event.created_at }
        : {}),
    };
  }
}

function parseEndpoint(data: Record<string, unknown>): WebhookEndpoint {
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
  };
}

function verificationError(
  message: string,
  code: string,
): WebhookVerificationError {
  return new WebhookVerificationError(message, { code });
}
