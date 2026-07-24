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
export const messageChannel = z.enum(["sms", "email"]);
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

// A version's content is the SMS or Email variant. The `channel` column on the version row is the
// authoritative discriminant; the version schema asserts the content matches it.
export const messageVariantContent = z.union([
  smsVariantContent,
  emailVariantContent,
]);
export type MessageVariantContent = z.infer<typeof messageVariantContent>;
