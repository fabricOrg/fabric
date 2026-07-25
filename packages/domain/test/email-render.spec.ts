import type { VariableSchema } from "@app/contracts";
import { describe, expect, it } from "vitest";
import { previewEmail } from "../src/email-render.js";
import { previewMessage } from "../src/message-preview.js";
import {
  DEFAULT_EMAIL_BASE_RATES,
  rateEmailFlat,
  UnknownCurrencyError,
} from "../src/rating.js";

const schema: VariableSchema = {
  type: "object",
  properties: { name: { type: "string" }, code: { type: "string" } },
  required: ["name"],
  additionalProperties: false,
};

describe("rateEmailFlat (ADR-0010 — flat per send)", () => {
  it("prices flat per send regardless of size", () => {
    expect(rateEmailFlat("GHS")).toBe(5n);
    expect(rateEmailFlat("NGN")).toBe(500n);
    expect(rateEmailFlat("USD")).toBe(2n);
  });

  it("prices against a passed rate table (the account's price book)", () => {
    expect(rateEmailFlat("GHS", { GHS: 9n })).toBe(9n);
  });

  it("throws on an unpriced currency (never silently priced)", () => {
    expect(() => rateEmailFlat("ZZZ")).toThrow(UnknownCurrencyError);
  });

  it("exposes a default flat rate table for the supported currencies", () => {
    expect(DEFAULT_EMAIL_BASE_RATES.GHS).toBe(5n);
  });
});

describe("previewEmail (SDK-007 slice 2)", () => {
  it("renders subject/text/html and prices flat per send", () => {
    const out = previewEmail({
      subject: "Order for {{name}}",
      text: "Hi {{name}}, code {{code}}",
      html: "<p>Hi {{name}}</p>",
      schema,
      data: { name: "Ada", code: "A1" },
      currency: "GHS",
    });
    expect(out.blockers).toEqual([]);
    expect(out.preview).toMatchObject({
      subject: "Order for Ada",
      text: "Hi Ada, code A1",
      html: "<p>Hi Ada</p>",
      cost_minor: "5",
      currency: "GHS",
    });
  });

  it("HTML-escapes a variable value in the html context but not in plain text", () => {
    const out = previewEmail({
      subject: "hello",
      text: "Hi {{name}}",
      html: "<p>Hi {{name}}</p>",
      schema,
      data: { name: "<script>alert(1)</script>" },
      currency: "GHS",
    });
    expect(out.preview?.html).toBe(
      "<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
    // Text is a plain-text context — the same value is NOT escaped there.
    expect(out.preview?.text).toBe("Hi <script>alert(1)</script>");
  });

  it("rejects a subject whose rendered value injects a newline (header injection)", () => {
    const out = previewEmail({
      subject: "Re: {{name}}",
      html: "<p>x</p>",
      schema,
      data: { name: "ok\nBcc: victim@example.com" },
      currency: "GHS",
    });
    expect(out.preview).toBeNull();
    expect(out.blockers).toEqual([
      { path: "subject", code: "subject_newline" },
    ]);
  });

  it("also rejects unicode line/paragraph separators in the subject", () => {
    for (const sep of [
      String.fromCharCode(0x2028),
      String.fromCharCode(0x2029),
    ]) {
      const out = previewEmail({
        subject: "Re: {{name}}",
        html: "<p>x</p>",
        schema,
        data: { name: `ok${sep}Bcc: victim@example.com` },
        currency: "GHS",
      });
      expect(out.preview).toBeNull();
      expect(out.blockers).toEqual([
        { path: "subject", code: "subject_newline" },
      ]);
    }
  });

  it("blocks an undeclared token at <part>.<token> without rendering", () => {
    const out = previewEmail({
      subject: "hi",
      html: "<p>{{ghost}}</p>",
      schema,
      data: { name: "Ada" },
      currency: "GHS",
    });
    expect(out.preview).toBeNull();
    expect(out.blockers).toContainEqual({
      path: "html.ghost",
      code: "unknown_token",
    });
  });

  it("blocks a missing required variable and never echoes the payload value", () => {
    const out = previewEmail({
      subject: "hi",
      html: "<p>{{name}}</p>",
      schema,
      data: { code: "SECRET-PII" },
      currency: "GHS",
    });
    expect(out.preview).toBeNull();
    expect(out.blockers).toContainEqual({
      path: "name",
      code: "missing_required",
    });
    // No blocker carries the rejected value.
    for (const b of out.blockers) {
      expect(JSON.stringify(b)).not.toContain("SECRET-PII");
    }
  });

  it("requires at least one of text/html", () => {
    const out = previewEmail({
      subject: "subject only",
      schema,
      data: { name: "Ada" },
      currency: "GHS",
    });
    expect(out.preview).toBeNull();
    expect(out.blockers).toContainEqual({
      path: "",
      code: "email_content_required",
    });
  });

  it("prices a large body flat — size does not change the price (ADR-0010)", () => {
    const out = previewEmail({
      subject: "s",
      html: `<p>{{name}}</p>`,
      schema,
      data: { name: "x".repeat(60_000) },
      currency: "GHS",
    });
    expect(out.preview?.cost_minor).toBe("5"); // flat, not size-scaled
    expect(out.preview?.size_bytes).toBeGreaterThan(51_200);
  });

  it("blocks a rendered payload over the hard ceiling", () => {
    const out = previewEmail({
      subject: "s",
      html: `<p>{{name}}</p>`,
      schema,
      data: { name: "x".repeat(300_000) },
      currency: "GHS",
    });
    expect(out.preview).toBeNull();
    expect(out.blockers).toContainEqual({
      path: "",
      code: "email_payload_too_large",
    });
  });

  it("is deterministic — same input renders the same output", () => {
    const input = {
      subject: "Order {{code}}",
      html: "<p>Hi {{name}}</p>",
      schema,
      data: { name: "Ada", code: "A1" },
      currency: "GHS" as const,
    };
    expect(previewEmail(input)).toEqual(previewEmail(input));
  });
});

describe("previewMessage dispatch", () => {
  it("routes an email input to previewEmail and tags the channel", () => {
    const out = previewMessage({
      channel: "email",
      subject: "hi {{name}}",
      html: "<p>{{name}}</p>",
      schema,
      data: { name: "Ada" },
      currency: "GHS",
    });
    expect(out.channel).toBe("email");
    expect(out.preview).toMatchObject({ subject: "hi Ada", cost_minor: "5" });
  });

  it("routes an sms input to previewSms and tags the channel", () => {
    const out = previewMessage({
      channel: "sms",
      template: "Hi {{name}}",
      schema,
      data: { name: "Ada" },
      currency: "GHS",
    });
    expect(out.channel).toBe("sms");
    expect(out.preview).toMatchObject({ body: "Hi Ada", segments: 1 });
  });
});
