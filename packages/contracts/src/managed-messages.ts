import { z } from "zod";
import { apiKeyEnv } from "./dev-portal.js";
import { emailAddress } from "./email.js";
import { messageChannel } from "./message-definition-content.js";
import { stableKey } from "./message-definitions.js";

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/, "Must be one E.164 number.");

export const messageDeliveryStatus = z.enum([
  "accepted",
  "processing",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "expired",
]);
export type MessageDeliveryStatus = z.infer<typeof messageDeliveryStatus>;

const metadataValue = z.union([z.string().max(500), z.number(), z.boolean()]);
export const messageMetadata = z
  .record(z.string().min(1).max(64), metadataValue)
  .refine((value) => JSON.stringify(value).length <= 4096, {
    message: "metadata must be at most 4096 bytes",
  });

export const sendManagedMessageRequest = z.object({
  key: stableKey,
  to: z.union([e164, emailAddress]),
  data: z.record(z.string(), z.unknown()).default({}),
  locale: z.string().optional(),
  channel: messageChannel.optional(),
  currency: z.string().length(3).default("GHS"),
  reference: z.string().trim().min(1).max(100).optional(),
  metadata: messageMetadata.default({}),
  limits: z
    .object({
      max_cost: z.object({
        minor: z.string().regex(/^\d+$/),
        currency: z.string().length(3),
      }),
    })
    .optional(),
});
export type SendManagedMessageRequest = z.infer<
  typeof sendManagedMessageRequest
>;

export const messageDeliveryAttempt = z.object({
  id: z.string().uuid(),
  ordinal: z.number().int().positive(),
  channel: messageChannel,
  message_id: z.string().uuid().nullable(),
  status: messageDeliveryStatus,
  cost: z.object({ minor: z.string(), currency: z.string().length(3) }),
  error_code: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MessageDeliveryAttempt = z.infer<typeof messageDeliveryAttempt>;

export const messageDelivery = z.object({
  id: z.string().uuid(),
  key: stableKey,
  version_id: z.string().uuid(),
  environment: apiKeyEnv,
  locale: z.string(),
  channel: messageChannel,
  status: messageDeliveryStatus,
  resource_version: z.number().int().positive(),
  recipient: z.string(),
  reference: z.string().nullable(),
  metadata: messageMetadata,
  cost: z.object({ minor: z.string(), currency: z.string().length(3) }),
  attempts: z.array(messageDeliveryAttempt),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MessageDelivery = z.infer<typeof messageDelivery>;

export const sendManagedMessageResponse = z.object({
  delivery: messageDelivery,
  request_id: z.string(),
});
export type SendManagedMessageResponse = z.infer<
  typeof sendManagedMessageResponse
>;

export const retrieveManagedMessageResponse = sendManagedMessageResponse;
export type RetrieveManagedMessageResponse = SendManagedMessageResponse;

// Webhook observability for one delivery: every fan-out row for the delivery's outbox events.
// The endpoint URL is included (the tenant registered it); the signing secret never is.
export const messageDeliveryWebhookStatus = z.object({
  event_id: z.string().uuid(),
  event_type: z.string(),
  endpoint_id: z.string().uuid(),
  endpoint_url: z.string(),
  state: z.enum(["pending", "delivering", "delivered", "dead"]),
  attempts: z.number().int().min(0),
  last_http_status: z.number().int().nullable(),
  last_error_category: z.string().nullable(),
  delivered_at: z.string().nullable(),
  created_at: z.string(),
});
export type MessageDeliveryWebhookStatus = z.infer<
  typeof messageDeliveryWebhookStatus
>;

export const messageDeliveryWebhooksResponse = z.object({
  webhooks: z.array(messageDeliveryWebhookStatus),
  request_id: z.string(),
});
export type MessageDeliveryWebhooksResponse = z.infer<
  typeof messageDeliveryWebhooksResponse
>;

// List rows omit attempts (fetched on the detail read) and the recipient (which requires a
// per-delivery PII-vault resolution — too costly and too sensitive for a log listing).
export const messageDeliverySummary = messageDelivery.omit({
  attempts: true,
  recipient: true,
});
export type MessageDeliverySummary = z.infer<typeof messageDeliverySummary>;

export const listMessageDeliveriesResponse = z.object({
  deliveries: z.array(messageDeliverySummary),
  request_id: z.string(),
});
export type ListMessageDeliveriesResponse = z.infer<
  typeof listMessageDeliveriesResponse
>;
