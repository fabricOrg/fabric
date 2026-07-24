import { describe, expect, it } from "vitest";
import {
  buildEmailContent,
  type EmailLocaleDraft,
  variablesFromEmail,
} from "./email-authoring";

function draft(
  overrides: Partial<Parameters<typeof buildEmailContent>[0]> = {},
) {
  return {
    from: "",
    subject: "Order {{order.id}} shipped",
    text: "Hi {{name}}, it shipped.",
    html: "",
    emailLocalizedVariants: [] as EmailLocaleDraft[],
    defaultLocale: "en",
    ...overrides,
  };
}

describe("email definition authoring", () => {
  it("collects tokens from subject, text, and html into one variable set", () => {
    const fields = variablesFromEmail(
      "Hi {{name}}",
      "Order {{order.id}}",
      "<p>{{name}} — {{cta.url}}</p>",
    );
    expect(fields.map((field) => field.name).sort()).toEqual([
      "cta.url",
      "name",
      "order.id",
    ]);
  });

  it("builds content with only the parts the author set, omitting a blank from/html", () => {
    const result = buildEmailContent(draft());
    expect(result.error).toBeNull();
    expect(result.content).toEqual({
      subject: "Order {{order.id}} shipped",
      text: "Hi {{name}}, it shipped.",
      locales: {},
    });
  });

  it("keeps an authored from when it is a valid address", () => {
    const result = buildEmailContent(draft({ from: "orders@shop.com" }));
    expect(result.content?.from).toBe("orders@shop.com");
  });

  it("rejects a blank subject, a body-less email, and an invalid from", () => {
    expect(buildEmailContent(draft({ subject: "  " })).content).toBeNull();
    expect(buildEmailContent(draft({ text: "", html: "" })).content).toBeNull();
    expect(
      buildEmailContent(draft({ from: "not-an-email" })).content,
    ).toBeNull();
  });

  it("rejects a subject carrying a line break (email header injection)", () => {
    const result = buildEmailContent(
      draft({ subject: "Hello\r\nBcc: victim@evil.com" }),
    );
    expect(result.content).toBeNull();
    expect(result.error).toMatch(/single line/);
  });

  it("rejects the unicode line separator in a subject", () => {
    // U+2028 is a JS/HTTP line terminator the renderer also rejects; build it by code point so the
    // source stays ASCII.
    const subject = `Hello${String.fromCharCode(0x2028)}world`;
    expect(buildEmailContent(draft({ subject })).content).toBeNull();
  });

  it("builds per-locale partial overrides and drops a fully blank override", () => {
    const result = buildEmailContent(
      draft({
        emailLocalizedVariants: [
          {
            id: "1",
            locale: "fr",
            subject: "Commande expédiée",
            text: "",
            html: "",
          },
        ],
      }),
    );
    expect(result.error).toBeNull();
    expect(result.content?.locales).toEqual({
      fr: { subject: "Commande expédiée" },
    });
  });

  it("rejects a locale override that duplicates the default locale", () => {
    const result = buildEmailContent(
      draft({
        emailLocalizedVariants: [
          { id: "1", locale: "en", subject: "dupe", text: "", html: "" },
        ],
      }),
    );
    expect(result.content).toBeNull();
  });

  it("rejects an override row with no subject or body", () => {
    const result = buildEmailContent(
      draft({
        emailLocalizedVariants: [
          { id: "1", locale: "fr", subject: "", text: "", html: "" },
        ],
      }),
    );
    expect(result.content).toBeNull();
  });
});
