import { z } from "zod";
import { messageStatus } from "./message-status.js";

export const deliveryMode = z.enum(["virtual", "live"]);
export type DeliveryMode = z.infer<typeof deliveryMode>;

/**
 * The PATCH body, as an object — the shape the handler actually reads.
 *
 * The route binding used to name the bare `deliveryMode` enum as its request contract, so the
 * document published the body as the literal string "virtual", while every caller correctly sent
 * `{ delivery_mode: "virtual" }`. That was inert while the specification was decoration; once
 * request validation went strict it rejected every call at `<root>` with "expected one of
 * virtual|live" — an error message describing a body nobody has ever sent.
 */
export const updateMessagingSettingsRequest = z.object({
  delivery_mode: deliveryMode,
});
export type UpdateMessagingSettingsRequest = z.infer<
  typeof updateMessagingSettingsRequest
>;

export const messagingSettings = z.object({
  delivery_mode: deliveryMode,
  locked: z.boolean(),
  reason: z.string().nullable(),
});
export type MessagingSettings = z.infer<typeof messagingSettings>;

export const virtualPhoneMessage = z.object({
  id: z.string().uuid(),
  to: z.string(),
  from: z.string(),
  body: z.string(),
  /**
   * True once the recipient's PII has been crypto-shredded (their DEK destroyed): the message, its
   * cost, and its delivery history survive, but `to` and `body` are gone for good. A first-class
   * state the UI renders — not an error, and not a value we can ever recover.
   */
  erased: z.boolean(),
  status: messageStatus,
  segments: z.number().int().positive(),
  created_at: z.string(),
  read_at: z.string().nullable(),
  direction: z.enum(["inbound", "outbound"]),
});
export type VirtualPhoneMessage = z.infer<typeof virtualPhoneMessage>;

export const virtualPhoneInbox = z.object({
  virtual_number: z.string(),
  messages: z.array(virtualPhoneMessage),
  next_cursor: z.string().nullable(),
  retention_days: z.number().int().positive(),
  can_clear: z.boolean().optional(),
});
export type VirtualPhoneInbox = z.infer<typeof virtualPhoneInbox>;

export const virtualPhoneReply = z.object({
  to: z.string().regex(/^\+[1-9]\d{7,14}$/, "Recipient must be E.164."),
  body: z.string().trim().min(1).max(1600),
});
export type VirtualPhoneReply = z.infer<typeof virtualPhoneReply>;

export const virtualPhoneReplyResponse = z.object({
  id: z.string().uuid(),
  keyword: z.enum(["STOP", "START", "HELP"]).nullable(),
  consent_changed: z.boolean(),
});
export type VirtualPhoneReplyResponse = z.infer<
  typeof virtualPhoneReplyResponse
>;
