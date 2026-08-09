import { z } from "zod";
import { messageStatus } from "./message-status.js";
import { nextCursor } from "./pagination.js";

export const whatsappTemplateCategory = z.enum([
  "marketing",
  "utility",
  "authentication",
  "service",
]);
export type WhatsappTemplateCategory = z.infer<typeof whatsappTemplateCategory>;

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
