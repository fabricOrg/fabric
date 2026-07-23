import { z } from "zod";
import { messageStatus } from "./message-status.js";

export const emailAddress = z.string().trim().email().max(320);

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

/** Dashboard-facing (BFF/internal) email inbox for the current workspace environment. */
export const emailInboxResponse = z.object({
  messages: z.array(emailMessage),
});
export type EmailInboxResponse = z.infer<typeof emailInboxResponse>;

/**
 * Decrypted email content for the sandbox viewer — the vault-stored body, exposed only through the
 * BFF (never the public message DTO). `erased` mirrors the SMS virtual phone: the recipient's data
 * was crypto-shredded, so subject/body are gone for good.
 */
export const emailContentResponse = z.object({
  id: z.string().uuid(),
  to: z.string(),
  from: z.string(),
  subject: z.string(),
  text: z.string().nullable(),
  html: z.string().nullable(),
  erased: z.boolean(),
});
export type EmailContentResponse = z.infer<typeof emailContentResponse>;
