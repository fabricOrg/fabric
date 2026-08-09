import { z } from "zod";
import { messageClass } from "./sms.js";

/**
 * Managed message VARIANT CONTENT — the per-channel content shapes and the channel discriminant.
 * SDK-003 shipped SMS; SDK-007 (ADR-0005 Amendment A1) adds Email. Split out of message-definitions.ts
 * to stay under the file-length guard; re-exported from ./message-definitions.js so import paths are
 * unchanged.
 */

export const localeTag = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, "invalid_locale");

// SMS variant content of a version.
export const smsVariantContent = z.object({
  body: z.string().min(1).max(1600),
  class: messageClass.default("transactional"),
  locales: z
    .record(localeTag, z.object({ body: z.string().min(1).max(1600) }).strict())
    .default({}),
});
export type SmsVariantContent = z.infer<typeof smsVariantContent>;

// The managed channel a definition version targets. A version is single-channel (ADR-0005 Amendment A1);
// multi-channel-per-intent is routing (SDK-008), not a version property.
export const messageChannel = z.enum(["sms", "email", "whatsapp"]);
export type MessageChannel = z.infer<typeof messageChannel>;

// Email variant content of a version. At least one of text/html must be present (a body-less email is
// rejected at authoring). Per-locale entries are partial overrides. Rendered server-side by the same
// renderer preview and managed send share (SDK-007 slice 2).
export const emailVariantContent = z
  .object({
    from: z.string().trim().email().max(320).optional(),
    subject: z.string().min(1).max(998),
    text: z.string().min(1).max(200_000).optional(),
    html: z.string().min(1).max(400_000).optional(),
    locales: z
      .record(
        localeTag,
        z
          .object({
            subject: z.string().min(1).max(998).optional(),
            text: z.string().min(1).max(200_000).optional(),
            html: z.string().min(1).max(400_000).optional(),
          })
          .strict(),
      )
      .default({}),
  })
  .superRefine((value, ctx) => {
    if (!value.text && !value.html) {
      ctx.addIssue({
        code: "custom",
        message: "email_content_required",
        path: [],
      });
    }
  });
export type EmailVariantContent = z.infer<typeof emailVariantContent>;

/**
 * WhatsApp variant content — a BINDING, not a body.
 *
 * SMS and email definitions own their text. WhatsApp content does not exist here at all: it lives in a
 * Meta-approved template, and Meta can pause or reject that template without telling us. So a WhatsApp
 * variant names the template and says how this definition's typed variables reach it.
 *
 * `parameters` is ORDERED and holds VARIABLE NAMES from the definition's variable schema, because a
 * Meta template takes positional body parameters — there are no names on the wire. Reordering this
 * array silently changes which value lands in which placeholder, so it is content, not configuration.
 *
 * Locale overrides carry a `template_language` rather than text: Meta stores one template per
 * name+language, so "the French version" IS a different template row, not a different string.
 */
export const whatsappVariantContent = z.object({
  template_name: z.string().trim().min(1).max(512),
  template_language: z.string().trim().min(1).max(35),
  template_category: z.enum(["marketing", "utility", "authentication"]),
  parameters: z.array(z.string().trim().min(1).max(128)).default([]),
  locales: z
    .record(
      localeTag,
      z
        .object({ template_language: z.string().trim().min(1).max(35) })
        .strict(),
    )
    .default({}),
});
export type WhatsappVariantContent = z.infer<typeof whatsappVariantContent>;

// A version's content is the SMS, Email or WhatsApp variant. The `channel` column on the version row
// is the authoritative discriminant; the version schema asserts the content matches it.
export const messageVariantContent = z.union([
  smsVariantContent,
  emailVariantContent,
  whatsappVariantContent,
]);
export type MessageVariantContent = z.infer<typeof messageVariantContent>;
