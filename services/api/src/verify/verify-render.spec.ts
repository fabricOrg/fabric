import type { SmsVariantContent, VariableSchema } from "@app/contracts";
import { describe, expect, it } from "vitest";
import { renderOtpBody } from "./verify-template.js";

const RESERVED = {
  code: "481920",
  expires_minutes: 5,
  expires_seconds: 300,
} as const;

const noVariables: VariableSchema = { type: "object", properties: {} };

function content(over: Partial<SmsVariantContent> = {}): SmsVariantContent {
  return {
    body: "Your code is {{code}}. It expires in {{expires_minutes}} minutes.",
    class: "transactional",
    locales: {},
    ...over,
  } as SmsVariantContent;
}

function render(over: Parameters<typeof renderOtpBody>[0] | object = {}) {
  return renderOtpBody({
    content: content(),
    schema: noVariables,
    defaultLocale: "en",
    reserved: RESERVED,
    ...(over as object),
  } as Parameters<typeof renderOtpBody>[0]);
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (
      error as { getResponse?: () => { error?: { code?: string } } }
    ).getResponse?.()?.error?.code;
  }
  return undefined;
}

describe("renderOtpBody", () => {
  /**
   * The regression that made the feature 100% non-functional. `validatePayload` checks every
   * property PRESENT in the data against its declaration, whether or not the template references
   * it — so declaring the reserved values as strings while passing numbers failed EVERY templated
   * request with `expected_string` at `expires_minutes`, including templates that never mention it.
   */
  it("renders when the template uses no reserved value but the code", () => {
    expect(render({ content: content({ body: "Code: {{code}}" }) })).toBe(
      "Code: 481920",
    );
  });

  it("renders the numeric reserved values", () => {
    expect(render()).toBe("Your code is 481920. It expires in 5 minutes.");
  });

  it("substitutes a caller variable alongside the code", () => {
    expect(
      render({
        content: content({ body: "{{platform}}: your code is {{code}}." }),
        schema: {
          type: "object",
          properties: { platform: { type: "string" } },
        } as VariableSchema,
        variables: { platform: "Convert" },
      }),
    ).toBe("Convert: your code is 481920.");
  });

  /**
   * The author marked the field mandatory precisely so this cannot happen. Rebuilding the schema
   * without `required` rendered "Your  verification code is …" — an empty brand, billed and
   * delivered — instead of refusing.
   */
  it("refuses a missing REQUIRED caller variable instead of rendering it blank", () => {
    expect(
      codeOf(() =>
        render({
          content: content({ body: "Your {{merchant}} code is {{code}}." }),
          schema: {
            type: "object",
            properties: { merchant: { type: "string" } },
            required: ["merchant"],
          } as VariableSchema,
        }),
      ),
    ).toBe("verify_template_unrenderable");
  });

  it("refuses a template with no {{code}} — the message would carry no code at all", () => {
    expect(
      codeOf(() =>
        render({ content: content({ body: "Welcome to {{platform}}." }) }),
      ),
    ).toBe("verify_template_missing_code");
  });

  it("refuses a promotional template", () => {
    expect(
      codeOf(() => render({ content: content({ class: "promotional" }) })),
    ).toBe("verify_template_not_transactional");
  });

  it("renders a requested locale variant", () => {
    expect(
      render({
        content: content({
          locales: { fr: { body: "Votre code est {{code}}." } },
        }),
        requestedLocale: "fr",
      }),
    ).toBe("Votre code est 481920.");
  });

  // Silently falling back would send a language the recipient may not read, and would disagree with
  // /v1/messages/preview, which answers `locale_not_supported` for the same definition.
  it("refuses a locale it has no variant for rather than silently sending another", () => {
    expect(codeOf(() => render({ requestedLocale: "fr" }))).toBe(
      "locale_not_supported",
    );
  });

  it("treats the default locale as the base body", () => {
    expect(render({ requestedLocale: "en" })).toBe(
      "Your code is 481920. It expires in 5 minutes.",
    );
  });

  // Second lock: even if a reserved name reached here, Fabric's value is applied last.
  it("cannot be shadowed by a caller variable of a reserved name", () => {
    expect(
      render({
        content: content({ body: "Code: {{code}}" }),
        // Cast because the CONTRACT already refuses this shape — that is the first lock. This test
        // is about the second: even if a reserved name reached the renderer, Fabric's value wins.
        variables: { code: "000000" } as unknown as Record<string, string>,
      }),
    ).toBe("Code: 481920");
  });
});
