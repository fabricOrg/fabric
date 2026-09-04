import { WebhookVerificationError } from "./errors.js";
import type { MessageStatus } from "./types.js";

export const KNOWN_WEBHOOK_EVENT_TYPES = [
  "message.accepted",
  "message.sent",
  "message.delivered",
  "message.undelivered",
  "message.failed",
  "message.inbound",
] as const;

export type KnownWebhookEventType = (typeof KNOWN_WEBHOOK_EVENT_TYPES)[number];

interface WebhookEventBase<TData> {
  /** Stable delivery identity. Persist under a unique constraint before applying side effects. */
  readonly id: string;
  readonly createdAt: string;
  readonly data: TData;
}

/**
 * The channels a webhook payload can name. Exported so a test can pin it against the API's own
 * `messageChannel` enum — the event TYPES already have that pin (`KNOWN_WEBHOOK_EVENT_TYPES`), and
 * the channels did not, which is how this list drifted a channel behind the API and rejected every
 * live inbound event.
 */
export const KNOWN_WEBHOOK_CHANNELS = ["sms", "email", "whatsapp"] as const;
export type KnownWebhookChannel = (typeof KNOWN_WEBHOOK_CHANNELS)[number];

export interface MessageWebhookData {
  readonly messageId: string;
  readonly deliveryId?: string;
  readonly key?: string;
  readonly versionId?: string;
  readonly resourceVersion?: number;
  readonly channel?: KnownWebhookChannel;
  readonly status?: MessageStatus;
  readonly previousStatus?: MessageStatus;
  readonly errorCode?: string;
}

export interface InboundMessageWebhookData {
  readonly messageId: string;
  /**
   * Live inbound is WhatsApp (the SMS provider has no mobile-originated path); the sandbox Virtual
   * Phone emits inbound `sms`. This union excluded WhatsApp entirely, so every live inbound event
   * was rejected.
   */
  readonly channel: KnownWebhookChannel;
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
    id: webhookString(event.id, "id"),
    createdAt: webhookString(event.created_at, "created_at"),
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
    ...(typeof data.delivery_id === "string"
      ? { deliveryId: data.delivery_id }
      : {}),
    ...(typeof data.key === "string" ? { key: data.key } : {}),
    ...(typeof data.version_id === "string"
      ? { versionId: data.version_id }
      : {}),
    ...(typeof data.resource_version === "number"
      ? { resourceVersion: data.resource_version }
      : {}),
    ...(data.channel === "sms" ||
    data.channel === "email" ||
    data.channel === "whatsapp"
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
  // Rejecting "whatsapp" threw `WebhookVerificationError` on every LIVE inbound event, which reads
  // as a forged payload or a wrong signing secret — sending the reader after a security problem that
  // isn't there. Both other values are real too: the sandbox Virtual Phone emits inbound `sms`
  // (`virtual-phone-operations.ts`), through the same outbox.
  if (channel !== "sms" && channel !== "email" && channel !== "whatsapp") {
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
