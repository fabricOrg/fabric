import { z } from "zod";
import { messageStatus } from "./message-status.js";
import { money } from "./money.js";
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
  cost: money,
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

/**
 * An APPROVED template from the tenant's synced Meta catalog — what a sender may actually choose.
 *
 * This exists because the alternative is what shipped first: free-text `template_name` and
 * `template_language` fields. A name Meta does not have fails at the provider AFTER the wallet
 * reserve, and nobody memorises `jaspers_market_order_confirmation_v1`.
 *
 * `category` is REPORTED, not chosen. Meta owns it, and it never reaches Meta on a send — it drives
 * OUR consent gate and OUR pricing traffic class, so a caller free-choosing `utility` for a template
 * Meta approved as `marketing` would bypass promotional consent and bill in the wrong class. The
 * template is the only honest source.
 *
 * `variable_count` is derived from the body's positional placeholders. Meta rejects a message whose
 * parameter count differs from the template's, and that rejection also lands after the reserve.
 */
export const whatsappTemplateSummary = z.object({
  name: z.string(),
  language: z.string(),
  category: whatsappTemplateCategory.nullable(),
  /** How many positional body parameters this template expects. */
  variable_count: z.number().int().nonnegative(),
  /** The body text as approved, for a preview — never editable here. */
  body_preview: z.string().nullable(),
});
export type WhatsappTemplateSummary = z.infer<typeof whatsappTemplateSummary>;

export const whatsappTemplateListResponse = z.object({
  templates: z.array(whatsappTemplateSummary),
  /** When the catalog was last reconciled with Meta — a stale list is a real state, so it is shown. */
  synced_at: z.string().nullable(),
  request_id: z.string(),
});
export type WhatsappTemplateListResponse = z.infer<
  typeof whatsappTemplateListResponse
>;

/**
 * Outcome of a WhatsApp template sync run.
 *
 * `locked: false` means another run held the advisory lock and this one did nothing — distinct from
 * a run that executed and synced zero records. Without that flag the two are indistinguishable, and
 * "synced: 0" reads as success for a silent failure. `failed` and `firstError` exist for the same
 * reason: a run where every tenant threw must not report the same shape as a quiet one.
 */
export const whatsappTemplateSyncResultSchema = z.object({
  locked: z.boolean(),
  synced: z.number().int().nonnegative(),
  tenants: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  firstError: z.string().optional(),
});
export type WhatsappTemplateSyncResult = z.infer<
  typeof whatsappTemplateSyncResultSchema
>;
