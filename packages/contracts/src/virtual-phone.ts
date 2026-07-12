import { z } from "zod";
import { messageStatus } from "./message-status.js";

export const deliveryMode = z.enum(["virtual", "live"]);
export type DeliveryMode = z.infer<typeof deliveryMode>;

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
});
export type VirtualPhoneMessage = z.infer<typeof virtualPhoneMessage>;

export const virtualPhoneInbox = z.object({
  messages: z.array(virtualPhoneMessage),
});
export type VirtualPhoneInbox = z.infer<typeof virtualPhoneInbox>;
