import { z } from "zod";
import { messageStatus } from "./message-status.js";
import { nextCursor } from "./pagination.js";

export const whatsappTemplateCategory = z.enum([
  "marketing",
  "utility",
  "authentication",
]);
export type WhatsappTemplateCategory = z.infer<typeof whatsappTemplateCategory>;

export const whatsappSendRequest = z
  .object({
    to: z.string().regex(/^\+[1-9]\d{7,14}$/, "Must be one E.164 number."),
    template_name: z.string().trim().min(1).max(512),
    template_language: z.string().trim().min(1).max(35),
    template_category: whatsappTemplateCategory,
    variables: z.array(z.string().max(1024)).default([]),
    currency: z.enum(["GHS", "NGN", "USD"]).default("GHS"),
  })
  .strict();
export type WhatsappSendRequest = z.infer<typeof whatsappSendRequest>;

export const whatsappMessage = z.object({
  id: z.string().uuid(),
  status: messageStatus,
  to: z.string(), // masked E.164, e.g. "+233 24● ●●● ●●12" — same shape as sms.ts / verify.ts
  provider: z.string(),
  template_name: z.string().nullable(),
  template_language: z.string().nullable(),
  template_category: whatsappTemplateCategory.nullable(),
  created_at: z.string(),
  error_code: z.string().nullable(),
});
export type WhatsappMessage = z.infer<typeof whatsappMessage>;

export const whatsappSendResponse = whatsappMessage.extend({
  request_id: z.string(),
});
export type WhatsappSendResponse = z.infer<typeof whatsappSendResponse>;

export const whatsappMessageResponse = z.object({
  message: whatsappMessage,
  request_id: z.string(),
});
export type WhatsappMessageResponse = z.infer<typeof whatsappMessageResponse>;

export const whatsappMessageListResponse = z.object({
  messages: z.array(whatsappMessage),
  next_cursor: nextCursor,
  request_id: z.string(),
});
export type WhatsappMessageListResponse = z.infer<
  typeof whatsappMessageListResponse
>;
