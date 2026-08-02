// SMS public API shapes (F5.2/F5.3/F5.4) — request + response DTOs the dashboard/SDK consume and the
// API produces. zod-only, browser-safe. Status is the canonical F5.3 enum (one source of truth).

import { z } from "zod";
import { messageStatus } from "./message-status.js";
import { money } from "./money.js";
import { nextCursor } from "./pagination.js";
import { deliveryMode } from "./virtual-phone.js";

/** GSM-7 vs UCS-2 — surfaced on responses (drives the segment count + cost). */
export const encoding = z.enum(["gsm7", "ucs2"]);
export type Encoding = z.infer<typeof encoding>;

/** One transition in a message's delivery history (DLR timeline, out-of-order tolerant). */
export const statusEvent = z.object({
  status: messageStatus,
  at: z.string(), // ISO-8601
  note: z.string().optional(),
});
export type StatusEvent = z.infer<typeof statusEvent>;

/** A row in the message log. Recipient is masked for PII (raw lives only in the vault).
 *  Wire casing is snake_case — the platform-wide convention (request DTOs, email, webhooks,
 *  senders). These fields were the one camelCase holdout; normalized pre-1.0 while the only
 *  consumers (dashboard BFF + SDK beta) are in-repo. */
export const messageSummary = z.object({
  id: z.string(), // "msg_…"
  to: z.string(), // masked E.164, e.g. "+233 24● ●●● ●●12"
  status: messageStatus,
  encoding,
  segments: z.number().int().positive(),
  cost: money,
  /**
   * What actually paid for this send.
   *
   * `cost` is the rate-card price and is charged to the wallet ONLY when backing is `wallet`. A
   * token-backed send takes nothing from the wallet — it consumes one credit per unit and discharges
   * deferred revenue at the lot's locked price, which is a different number from `cost`. Showing
   * `cost` without this would tell a customer they were charged money they were not.
   *
   * Defaulted so an older API degrades to the historical wallet assumption rather than failing.
   */
  backing: z
    .enum(["wallet", "tokens", "sandbox_allowance"])
    .optional()
    .default("wallet"),
  provider: z.string(),
  delivery_mode: deliveryMode.optional().default("live"),
  created_at: z.string(),
});
export type MessageSummary = z.infer<typeof messageSummary>;

/** Full message detail (drawer): summary + body (may be redacted), timeline, failure reason. */
export const messageDetail = messageSummary.extend({
  sender_id: z.string(),
  body: z.string().optional(), // absent when redacted
  redacted: z.boolean(),
  timeline: z.array(statusEvent),
  failure_reason: z.string().optional(), // set when undelivered/failed
  request_id: z.string().optional(), // req_… — support handle on failures
});
export type MessageDetail = z.infer<typeof messageDetail>;

/** Traffic classification (E10-S5 / NCC 2442). Promotional traffic is DND-filtered and
 *  quiet-hours-bound; transactional (OTP, receipts, alerts) bypasses both 24/7. Declared by the
 *  sender — misclassification is a compliance violation on the CUSTOMER, and it's audited. */
export const messageClass = z.enum(["transactional", "promotional"]);
export type MessageClass = z.infer<typeof messageClass>;

/** POST /v1/sms/send request. Server re-computes segments/cost — client estimate is advisory. */
export const sendSmsRequest = z
  .object({
    to: z.string().regex(/^\+[1-9]\d{7,14}$/, "Must be one E.164 number."),
    sender_id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9 ]{0,10}$/, "Invalid sender ID."),
    body: z.string().trim().min(1).max(1600),
    currency: z.enum(["GHS", "NGN", "USD"]).default("GHS"),
    // Defaults to transactional: the platform's wedge traffic is OTP/receipts. Promotional MUST
    // be declared to get its (stricter) treatment.
    class: messageClass.default("transactional"),
  })
  .strict();
export type SendSmsRequest = z.infer<typeof sendSmsRequest>;

/** Accepted-send response (what the compose flow shows on success). */
export const sendSmsResponse = z.object({
  id: z.string(),
  status: messageStatus,
  encoding,
  segments: z.number().int().positive(),
  cost: money,
});
export type SendSmsResponse = z.infer<typeof sendSmsResponse>;

export const sendSmsApiResponse = sendSmsResponse.extend({
  request_id: z.string(),
});
export type SendSmsApiResponse = z.infer<typeof sendSmsApiResponse>;

/** GET /v1/messages - newest-first tenant message log, cursor-paginated. */
export const messageListResponse = z.object({
  messages: z.array(messageSummary),
  next_cursor: nextCursor,
  request_id: z.string(),
});
export type MessageListResponse = z.infer<typeof messageListResponse>;

/** GET /v1/sms/:id - one tenant-scoped message. */
export const messageDetailResponse = z.object({
  message: messageDetail,
  request_id: z.string(),
});
export type MessageDetailResponse = z.infer<typeof messageDetailResponse>;

/** One provider-error bucket in the messaging-insights delivery breakdown (most frequent first). */
export const insightsErrorBucket = z.object({
  code: z.string(),
  description: z.string(),
  count: z.number().int().nonnegative(),
});
export type InsightsErrorBucket = z.infer<typeof insightsErrorBucket>;

/**
 * Messaging-insights rollup (Messages → Insights tab). Aggregated from the tenant's `messages`.
 * Invariant: delivered + failed <= total_sent (the remainder is still in-flight).
 */
export const messagingInsights = z
  .object({
    total_sent: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    avg_segments: z.number().nonnegative(),
    errors: z.array(insightsErrorBucket),
  })
  .refine((s) => s.delivered + s.failed <= s.total_sent, {
    message: "delivered + failed must not exceed total_sent",
    path: ["total_sent"],
  });
export type MessagingInsights = z.infer<typeof messagingInsights>;

/** GET /v1/messages/insights — the rollup + a support-handoff request id. */
export const messagingInsightsResponse = z.object({
  summary: messagingInsights,
  request_id: z.string(),
});
export type MessagingInsightsResponse = z.infer<
  typeof messagingInsightsResponse
>;
