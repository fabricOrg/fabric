import type { z } from "zod";
import type { SmsVariantContent } from "./message-definitions.js";

export function withoutDuplicateDefaultLocale(
  value: { content: SmsVariantContent; default_locale: string },
  ctx: z.RefinementCtx,
): void {
  if (value.content.locales[value.default_locale]) {
    ctx.addIssue({
      code: "custom",
      message: "default_locale_must_not_be_duplicated",
      path: ["content", "locales", value.default_locale],
    });
  }
}
