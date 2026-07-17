import { z } from "zod";
import {
  definitionEnvironment,
  localeTag,
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

export const previewMessageResponse = z.object({
  version_id: z.string().uuid(),
  environment: definitionEnvironment,
  resolved_locale: z.string(),
  blockers: z.array(previewBlocker),
  warnings: z.array(previewBlocker),
  eligible: z.boolean(),
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
  request_id: z.string(),
});
export type PreviewMessageResponse = z.infer<typeof previewMessageResponse>;
