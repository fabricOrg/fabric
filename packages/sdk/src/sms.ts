import type { Transport } from "./transport.js";
import type {
  FabricResponse,
  IdempotentWriteOptions,
  ListParams,
  MessageDetail,
  MessageSummary,
  Page,
  RequestOptions,
  SendSmsBatchItem,
  SendSmsParams,
  SentSms,
  SmsBatch,
  WriteOptions,
} from "./types.js";
import {
  ApiShapeError,
  booleanField,
  enumField,
  nullableStringField,
  numberField,
  pageQueryString,
  record,
  requireE164,
  requireNonEmpty,
  stringField,
} from "./validation.js";

const MESSAGE_STATUSES = [
  "queued",
  "sending",
  "accepted",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "expired",
] as const;

export class SmsResource {
  constructor(private readonly transport: Transport) {}

  async send(
    params: SendSmsParams,
    options?: WriteOptions,
  ): Promise<FabricResponse<SentSms>> {
    requireE164(params.to);
    requireNonEmpty(params.senderId, "senderId");
    requireNonEmpty(params.body, "body");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/sms/messages",
      body: {
        to: params.to,
        sender_id: params.senderId,
        body: params.body,
        currency: params.currency ?? "GHS",
        class: params.class ?? "transactional",
      },
      ...(options ? { options } : {}),
    });
    return { ...response, data: sentSms(response.data) };
  }

  async sendBatch(
    items: ReadonlyArray<SendSmsBatchItem>,
    options: IdempotentWriteOptions,
  ): Promise<FabricResponse<SmsBatch>> {
    requireNonEmpty(options.idempotencyKey, "idempotencyKey");
    if (items.length < 1 || items.length > 100) {
      throw new TypeError("`items` must contain between 1 and 100 messages.");
    }
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/sms/batches",
      body: {
        items: items.map((item) => {
          requireNonEmpty(item.clientReference, "clientReference");
          requireE164(item.to);
          requireNonEmpty(item.senderId, "senderId");
          requireNonEmpty(item.body, "body");
          return {
            client_reference: item.clientReference,
            to: item.to,
            sender_id: item.senderId,
            body: item.body,
            currency: item.currency ?? "GHS",
            class: item.class ?? "transactional",
          };
        }),
      },
      options,
    });
    return { ...response, data: smsBatch(response.data) };
  }

  async retrieveBatch(
    id: string,
    options?: RequestOptions,
  ): Promise<FabricResponse<SmsBatch>> {
    requireNonEmpty(id, "id");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/v1/sms/batches/${encodeURIComponent(id)}`,
      ...(options ? { options } : {}),
    });
    return { ...response, data: smsBatch(response.data) };
  }

  async retrieve(
    id: string,
    options?: RequestOptions,
  ): Promise<FabricResponse<MessageDetail>> {
    requireNonEmpty(id, "id");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/v1/sms/${encodeURIComponent(id)}`,
      ...(options ? { options } : {}),
    });
    return { ...response, data: messageDetail(record(response.data.message)) };
  }

  async list(
    params?: ListParams,
    options?: RequestOptions,
  ): Promise<FabricResponse<Page<MessageSummary>>> {
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/v1/messages${pageQueryString(params)}`,
      ...(options ? { options } : {}),
    });
    if (!Array.isArray(response.data.messages))
      throw new ApiShapeError("messages");
    return {
      ...response,
      data: {
        items: response.data.messages.map((item) =>
          messageSummary(record(item)),
        ),
        nextCursor: nullableStringField(
          response.data.next_cursor,
          "next_cursor",
        ),
      },
    };
  }

  /** Walk the whole message log page by page, following `next_cursor` until it is null. */
  async *iterate(
    params?: Pick<ListParams, "limit">,
    options?: RequestOptions,
  ): AsyncGenerator<MessageSummary, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await this.list(
        {
          ...(params?.limit ? { limit: params.limit } : {}),
          ...(cursor ? { cursor } : {}),
        },
        options,
      );
      yield* page.data.items;
      const next = page.data.nextCursor ?? undefined;
      // defensive: a buggy server echoing the same cursor must not hang the client
      cursor = next === cursor ? undefined : next;
    } while (cursor);
  }
}

function smsBatch(data: Record<string, unknown>): SmsBatch {
  if (!Array.isArray(data.items)) throw new ApiShapeError("items");
  return {
    id: stringField(data.id, "id"),
    status: enumField(
      data.status,
      ["processing", "completed"] as const,
      "status",
    ),
    totalCount: numberField(data.total_count, "total_count"),
    acceptedCount: numberField(data.accepted_count, "accepted_count"),
    failedCount: numberField(data.failed_count, "failed_count"),
    items: data.items.map((value) => {
      const item = record(value);
      return {
        clientReference: stringField(item.client_reference, "client_reference"),
        messageId: typeof item.message_id === "string" ? item.message_id : null,
        status: enumField(item.status, MESSAGE_STATUSES, "status"),
        errorCode: typeof item.error_code === "string" ? item.error_code : null,
      };
    }),
  };
}

function sentSms(data: Record<string, unknown>): SentSms {
  const cost = record(data.cost);
  return {
    id: stringField(data.id, "id"),
    status: enumField(data.status, MESSAGE_STATUSES, "status"),
    encoding: enumField(data.encoding, ["gsm7", "ucs2"] as const, "encoding"),
    segments: numberField(data.segments, "segments"),
    cost: {
      minor: stringField(cost.minor, "cost.minor"),
      currency: enumField(
        cost.currency,
        ["GHS", "NGN", "USD"] as const,
        "cost.currency",
      ),
    },
  };
}

function messageSummary(data: Record<string, unknown>): MessageSummary {
  return {
    ...sentSms(data),
    to: stringField(data.to, "to"),
    provider: stringField(data.provider, "provider"),
    deliveryMode: enumField(
      data.delivery_mode ?? "live",
      ["live", "virtual"] as const,
      "delivery_mode",
    ),
    createdAt: stringField(data.created_at, "created_at"),
  };
}

function messageDetail(data: Record<string, unknown>): MessageDetail {
  const timeline = Array.isArray(data.timeline)
    ? data.timeline.map((entry) => {
        const item = record(entry);
        return {
          status: enumField(item.status, MESSAGE_STATUSES, "timeline.status"),
          at: stringField(item.at, "timeline.at"),
          ...(typeof item.note === "string" ? { note: item.note } : {}),
        };
      })
    : [];
  return {
    ...messageSummary(data),
    senderId: stringField(data.sender_id, "sender_id"),
    redacted: booleanField(data.redacted, "redacted"),
    timeline,
    ...(typeof data.body === "string" ? { body: data.body } : {}),
    ...(typeof data.failure_reason === "string"
      ? { failureReason: data.failure_reason }
      : {}),
  };
}
