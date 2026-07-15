import { WebhookVerificationError } from "./errors.js";
import type { MessageStatus } from "./types.js";

export const KNOWN_WEBHOOK_EVENT_TYPES = [
  "message.sent",
  "message.delivered",
  "message.undelivered",
  "message.failed",
  "message.inbound",
] as const;

export type KnownWebhookEventType = (typeof KNOWN_WEBHOOK_EVENT_TYPES)[number];

interface WebhookEventBase<TData> {
  readonly id?: string;
  readonly createdAt?: string;
  readonly data: TData;
}

export interface MessageWebhookData {
  readonly messageId: string;
  readonly channel?: "sms" | "email";
  readonly status?: MessageStatus;
  readonly previousStatus?: MessageStatus;
  readonly errorCode?: string;
}

export interface InboundMessageWebhookData {
  readonly messageId: string;
  readonly channel: "sms" | "email";
}

export type KnownWebhookEvent =
  | (WebhookEventBase<MessageWebhookData> & {
      readonly type: Exclude<KnownWebhookEventType, "message.inbound">;
    })
  | (WebhookEventBase<InboundMessageWebhookData> & {
      readonly type: "message.inbound";
    });

/** A correctly signed event produced by a newer API version than this SDK understands. */
export interface UnknownWebhookEvent extends WebhookEventBase<unknown> {
  readonly type: "unknown";
  readonly originalType: string;
}

export type WebhookEvent = KnownWebhookEvent | UnknownWebhookEvent;

const MESSAGE_STATUSES = [
  "accepted",
  "queued",
  "sending",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "expired",
] as const;

export function parseWebhookEvent(value: unknown): WebhookEvent {
  const event = webhookRecord(value);
  const originalType = typeof event.type === "string" ? event.type : "unknown";
  const envelope = {
    ...(typeof event.id === "string" ? { id: event.id } : {}),
    ...(typeof event.created_at === "string"
      ? { createdAt: event.created_at }
      : {}),
  };
  if (!isKnownEventType(originalType)) {
    return {
      ...envelope,
      type: "unknown",
      originalType,
      data: event.data ?? event,
    };
  }
  if (originalType === "message.inbound") {
    return {
      ...envelope,
      type: originalType,
      data: parseInboundData(event.data),
    };
  }
  return {
    ...envelope,
    type: originalType,
    data: parseMessageData(event.data),
  };
}

function isKnownEventType(value: string): value is KnownWebhookEventType {
  return (KNOWN_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

function parseMessageData(value: unknown): MessageWebhookData {
  const data = webhookRecord(value);
  return {
    messageId: webhookString(data.message_id, "data.message_id"),
    ...(data.channel === "sms" || data.channel === "email"
      ? { channel: data.channel }
      : {}),
    ...(isMessageStatus(data.status) ? { status: data.status } : {}),
    ...(isMessageStatus(data.previous_status)
      ? { previousStatus: data.previous_status }
      : {}),
    ...(typeof data.error_code === "string"
      ? { errorCode: data.error_code }
      : {}),
  };
}

function parseInboundData(value: unknown): InboundMessageWebhookData {
  const data = webhookRecord(value);
  const channel = data.channel;
  if (channel !== "sms" && channel !== "email") {
    throw invalidEvent("data.channel");
  }
  return {
    messageId: webhookString(data.id, "data.id"),
    channel,
  };
}

function webhookRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidEvent("data");
  }
  return value as Record<string, unknown>;
}

function webhookString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidEvent(field);
  }
  return value;
}

function isMessageStatus(value: unknown): value is MessageStatus {
  return (
    typeof value === "string" &&
    (MESSAGE_STATUSES as readonly string[]).includes(value)
  );
}

function invalidEvent(field: string): WebhookVerificationError {
  return new WebhookVerificationError(
    `The verified webhook payload has an invalid \`${field}\`.`,
    { code: "invalid_event_payload" },
  );
}
