// SMS public API shapes (F5.2/F5.3/F5.4) — request + response DTOs the dashboard/SDK consume and the
// API produces. zod-only, browser-safe. Status is the canonical F5.3 enum (one source of truth).

import { z } from "zod";
import { messageStatus } from "./message-status.js";
import { money } from "./money.js";
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

/** A row in the message log. Recipient is masked for PII (raw lives only in the vault). */
export const messageSummary = z.object({
  id: z.string(), // "msg_…"
  to: z.string(), // masked E.164, e.g. "+233 24● ●●● ●●12"
  status: messageStatus,
  encoding,
  segments: z.number().int().positive(),
  cost: money,
  provider: z.string(),
  deliveryMode: deliveryMode.optional().default("live"),
  createdAt: z.string(),
});
export type MessageSummary = z.infer<typeof messageSummary>;

/** Full message detail (drawer): summary + body (may be redacted), timeline, failure reason. */
export const messageDetail = messageSummary.extend({
  senderId: z.string(),
  body: z.string().optional(), // absent when redacted
  redacted: z.boolean(),
  timeline: z.array(statusEvent),
  failureReason: z.string().optional(), // set when undelivered/failed
  requestId: z.string().optional(), // req_… — support handle on failures
});
export type MessageDetail = z.infer<typeof messageDetail>;

/** Traffic classification (E10-S5 / NCC 2442). Promotional traffic is DND-filtered and
 *  quiet-hours-bound; transactional (OTP, receipts, alerts) bypasses both 24/7. Declared by the
 *  sender — misclassification is a compliance violation on the CUSTOMER, and it's audited. */
export const messageClass = z.enum(["transactional", "promotional"]);
export type MessageClass = z.infer<typeof messageClass>;

/** POST /v1/sms/send request. Server re-computes segments/cost — client estimate is advisory. */
export const sendSmsRequest = z.object({
  to: z.string(), // E.164
  senderId: z.string(),
  body: z.string().min(1),
  // Defaults to transactional: the platform's wedge traffic is OTP/receipts. Promotional MUST
  // be declared to get its (stricter) treatment.
  class: messageClass.default("transactional"),
});
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

/** GET /v1/messages - newest-first tenant message log. */
export const messageListResponse = z.object({
  messages: z.array(messageSummary),
  request_id: z.string(),
});
export type MessageListResponse = z.infer<typeof messageListResponse>;

/** GET /v1/sms/:id - one tenant-scoped message. */
export const messageDetailResponse = z.object({
  message: messageDetail,
  request_id: z.string(),
});
export type MessageDetailResponse = z.infer<typeof messageDetailResponse>;
