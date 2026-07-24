import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError } from "./errors.js";
import type { Transport } from "./transport.js";
import type {
  FabricResponse,
  ListParams,
  Page,
  RequestOptions,
  WebhookDelivery,
  WebhookEndpoint,
  WriteOptions,
} from "./types.js";
import {
  nullableStringField,
  pageQueryString,
  record,
  requireNonEmpty,
  stringField,
} from "./validation.js";
import { parseWebhookEvent, type WebhookEvent } from "./webhook-events.js";
import { parseDelivery, parseEndpoint } from "./webhook-parsers.js";

export interface CreateWebhookParams {
  readonly url: string;
  readonly description?: string;
  readonly applicationId?: string;
  readonly environment?: "sandbox" | "live";
}
export interface CreatedWebhookEndpoint extends WebhookEndpoint {
  readonly secret: string;
}
export interface ListWebhookDeliveriesParams extends ListParams {
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

  /**
   * Take an endpoint out of service. The Fabric API soft-deletes: the endpoint is marked
   * `disabled` and its delivery history is retained for inspection and replay.
   */
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

  /** Alias of {@link remove} — the API disables rather than hard-deletes, so both are the same call. */
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
  ): Promise<FabricResponse<Page<WebhookDelivery>>> {
    requireNonEmpty(endpointId, "endpointId");
    const page = pageQueryString(params);
    const query = params.state
      ? `${page ? `${page}&` : "?"}state=${params.state}`
      : page;
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
      data: {
        items: response.data.deliveries.map((item) =>
          parseDelivery(record(item)),
        ),
        nextCursor: nullableStringField(
          response.data.next_cursor,
          "next_cursor",
        ),
      },
    };
  }

  /** Walk an endpoint's delivery history page by page, following `next_cursor` until null. */
  async *iterateDeliveries(
    endpointId: string,
    params: Omit<ListWebhookDeliveriesParams, "cursor"> = {},
    options?: RequestOptions,
  ): AsyncGenerator<WebhookDelivery, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await this.listDeliveries(
        endpointId,
        { ...params, ...(cursor ? { cursor } : {}) },
        options,
      );
      yield* page.data.items;
      cursor = page.data.nextCursor ?? undefined;
    } while (cursor);
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

function verificationError(
  message: string,
  code: string,
): WebhookVerificationError {
  return new WebhookVerificationError(message, { code });
}
