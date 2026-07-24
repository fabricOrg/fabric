import type { z } from "zod";

// Structural over both variant contents (SMS + Email) — each carries a `locales` record — so the same
// guard applies to a channel-discriminated create/add-version request.
export function withoutDuplicateDefaultLocale(
  value: {
    content: { locales: Record<string, unknown> };
    default_locale: string;
  },
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
