// SMS public API shapes (F5.2/F5.3/F5.4) — request + response DTOs the dashboard/SDK consume and the
// API produces. zod-only, browser-safe. Status is the canonical F5.3 enum (one source of truth).

import { z } from "zod";
import { messageStatus } from "./message-status.js";
import { money } from "./money.js";

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

/** POST /v1/sms/send request. Server re-computes segments/cost — client estimate is advisory. */
export const sendSmsRequest = z.object({
  to: z.string(), // E.164
  senderId: z.string(),
  body: z.string().min(1),
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
