import { z } from "zod";
import { messageClass } from "./sms.js";

export const smsTemplateId = z.string().uuid();

export const smsTemplate = z.object({
  id: smsTemplateId,
  name: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(1600),
  class: messageClass,
  created_at: z.string(),
  updated_at: z.string(),
});
export type SmsTemplate = z.infer<typeof smsTemplate>;

export const listSmsTemplatesResponse = z.object({
  templates: z.array(smsTemplate),
});
export type ListSmsTemplatesResponse = z.infer<typeof listSmsTemplatesResponse>;

export const createSmsTemplateRequest = smsTemplate.pick({
  name: true,
  body: true,
  class: true,
});
export type CreateSmsTemplateRequest = z.infer<typeof createSmsTemplateRequest>;

export const updateSmsTemplateRequest = createSmsTemplateRequest
  .partial()
  .refine(
    (input) => Object.keys(input).length > 0,
    "Provide at least one template field to update.",
  );
export type UpdateSmsTemplateRequest = z.infer<typeof updateSmsTemplateRequest>;
