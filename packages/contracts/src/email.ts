import { z } from "zod";
import { messageStatus } from "./message-status.js";

const emailAddress = z.string().trim().email().max(320);

export const sendEmailRequest = z
  .object({
    to: emailAddress,
    from: emailAddress,
    subject: z.string().trim().min(1).max(998),
    text: z.string().min(1).max(1_000_000).optional(),
    html: z.string().min(1).max(2_000_000).optional(),
    reply_to: emailAddress.optional(),
  })
  .refine((value) => value.text !== undefined || value.html !== undefined, {
    message: "Provide at least one of `text` or `html`.",
    path: ["text"],
  });
export type SendEmailRequest = z.infer<typeof sendEmailRequest>;

export const emailMessage = z.object({
  id: z.string().uuid(),
  status: messageStatus,
  to: z.string(),
  from: z.string(),
  subject: z.string(),
  provider: z.string(),
  created_at: z.string(),
  error_code: z.string().nullable(),
});
export type EmailMessage = z.infer<typeof emailMessage>;

export const sendEmailResponse = emailMessage.pick({ id: true, status: true });
export const sendEmailApiResponse = sendEmailResponse.extend({
  request_id: z.string(),
});
export type SendEmailApiResponse = z.infer<typeof sendEmailApiResponse>;

export const emailMessageResponse = z.object({
  message: emailMessage,
  request_id: z.string(),
});
export type EmailMessageResponse = z.infer<typeof emailMessageResponse>;

export const emailMessageListResponse = z.object({
  messages: z.array(emailMessage),
  request_id: z.string(),
});
export type EmailMessageListResponse = z.infer<typeof emailMessageListResponse>;
