import type { Transport } from "./transport.js";
import type {
  FabricResponse,
  MessageDetail,
  MessageSummary,
  RequestOptions,
  SendSmsParams,
  SentSms,
} from "./types.js";
import {
  ApiShapeError,
  booleanField,
  enumField,
  numberField,
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
    options?: RequestOptions,
  ): Promise<FabricResponse<SentSms>> {
    requireE164(params.to);
    requireNonEmpty(params.senderId, "senderId");
    requireNonEmpty(params.body, "body");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/sms/send",
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
    options?: RequestOptions,
  ): Promise<FabricResponse<ReadonlyArray<MessageSummary>>> {
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: "/v1/messages",
      ...(options ? { options } : {}),
    });
    if (!Array.isArray(response.data.messages))
      throw new ApiShapeError("messages");
    return {
      ...response,
      data: response.data.messages.map((item) => messageSummary(record(item))),
    };
  }
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
      data.deliveryMode ?? "live",
      ["live", "virtual"] as const,
      "deliveryMode",
    ),
    createdAt: stringField(data.createdAt, "createdAt"),
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
    senderId: stringField(data.senderId, "senderId"),
    redacted: booleanField(data.redacted, "redacted"),
    timeline,
    ...(typeof data.body === "string" ? { body: data.body } : {}),
    ...(typeof data.failureReason === "string"
      ? { failureReason: data.failureReason }
      : {}),
  };
}
