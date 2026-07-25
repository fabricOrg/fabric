import { z } from "zod";
import {
  definitionEnvironment,
  localeTag,
  messageChannel,
  stableKey,
} from "./message-definitions.js";

/**
 * Public message preview (messages.preview, SDK-003 slice 5). Preview a RELEASED definition for the
 * presenting key's environment. A runtime scope may inspect a published definition; no send, charge,
 * or persistence occurs.
 */
export const previewMessageRequest = z.object({
  key: stableKey,
  data: z.record(z.string(), z.unknown()).optional(),
  currency: z.string().length(3).optional(),
  to: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "invalid_e164")
    .optional(),
  locale: localeTag.optional(),
  // Optional caller assertion of the released definition's channel. When present it must match the
  // resolved channel (else 400 channel_mismatch); the generated catalog types constrain it per key so
  // a channel-unsupported call fails to compile (SDK-007 AC04 / inherited SDK-004-AC02).
  channel: messageChannel.optional(),
});
export type PreviewMessageRequest = z.infer<typeof previewMessageRequest>;

// A field-path error that blocks the preview (missing/extra/wrong-type variable, unknown token, …).
// Carries only a path + stable code — never the rejected value (no PII).
export const previewBlocker = z.object({
  path: z.string(),
  code: z.string(),
});

export const smsPreviewResult = z.object({
  body: z.string(),
  encoding: z.enum(["gsm7", "ucs2"]),
  length: z.number().int(),
  segments: z.number().int(),
  cost_minor: z.string(),
  currency: z.string(),
});
export type SmsPreviewResult = z.infer<typeof smsPreviewResult>;

// Email preview result (SDK-007 slice 3). Rendered subject/text/html, the rendered UTF-8 byte size, and
// the exact FLAT per-send price (ADR-0010 — the size tier is retired). Parallel to smsPreviewResult; the
// two are carried in separate nullable fields (`preview` / `email_preview`) discriminated by `channel`
// so an SMS consumer that only reads `preview` is unaffected.
export const emailPreviewResult = z.object({
  subject: z.string(),
  text: z.string().nullable(),
  html: z.string().nullable(),
  size_bytes: z.number().int(),
  cost_minor: z.string(),
  currency: z.string(),
});
export type EmailPreviewResult = z.infer<typeof emailPreviewResult>;

export const previewMessageResponse = z.object({
  channel: messageChannel,
  version_id: z.string().uuid(),
  environment: definitionEnvironment,
  resolved_locale: z.string(),
  blockers: z.array(previewBlocker),
  warnings: z.array(previewBlocker),
  eligible: z.boolean(),
  // SMS sender/compliance. For an Email release these are not applicable — sender_id is empty and status
  // is `not_evaluated` (email sending-domain binding is a later slice); message_class defaults transactional.
  sender: z.object({
    sender_id: z.string(),
    status: z.enum([
      "sandbox",
      "active",
      "pending",
      "rejected",
      "unregistered",
      "not_evaluated",
    ]),
  }),
  message_class: z.enum(["transactional", "promotional"]),
  preview: smsPreviewResult.nullable(),
  email_preview: emailPreviewResult.nullable(),
  request_id: z.string(),
});
export type PreviewMessageResponse = z.infer<typeof previewMessageResponse>;
