import type { VariableSchema } from "@app/contracts";
import { describe, expect, it } from "vitest";
import { previewSms, validatePayload } from "../src/message-render.js";
import { rateSegments } from "../src/rating.js";
import { encodeAndSegment } from "../src/segmentation.js";

const schema: VariableSchema = {
  type: "object",
  properties: {
    name: { type: "string", maxLength: 40 },
    count: { type: "integer", minimum: 1 },
    tier: { type: "string", enum: ["gold", "silver"] },
    email: { type: "string", format: "email" },
  },
  required: ["name"],
  additionalProperties: false,
};

describe("validatePayload (SDK-003 slice 3)", () => {
  it("accepts a conforming payload", () => {
    const errs = validatePayload(schema, {
      name: "Ada",
      count: 3,
      tier: "gold",
    });
    expect(errs).toEqual([]);
  });

  it("flags a missing required property by path", () => {
    expect(validatePayload(schema, { count: 3 })).toContainEqual({
      path: "name",
      code: "missing_required",
    });
  });

  it("flags an unexpected (undeclared) property — closed object", () => {
    expect(validatePayload(schema, { name: "Ada", ghost: "x" })).toContainEqual(
      {
        path: "ghost",
        code: "unexpected_property",
      },
    );
  });

  it("flags a wrong type by path", () => {
    expect(
      validatePayload(schema, { name: "Ada", count: "three" }),
    ).toContainEqual({ path: "count", code: "expected_integer" });
  });

  it("flags an out-of-enum value and a bad format", () => {
    const errs = validatePayload(schema, {
      name: "Ada",
      tier: "bronze",
      email: "not-an-email",
    });
    expect(errs).toContainEqual({ path: "tier", code: "not_in_enum" });
    expect(errs).toContainEqual({ path: "email", code: "invalid_format" });
  });

  it("never echoes the rejected value into an error (no PII)", () => {
    const secret = "+233545227189";
    const errs = validatePayload(schema, { name: "Ada", count: secret });
    const serialized = JSON.stringify(errs);
    expect(serialized).not.toContain(secret);
    // Every error is exactly { path, code } — no extra keys that could carry data.
    for (const e of errs)
      expect(Object.keys(e).sort()).toEqual(["code", "path"]);
  });
});

describe("previewSms (SDK-003 slice 3)", () => {
  const template = "Hi {{name}}, you have {{count}} orders.";

  it("renders a valid preview with encoding, segments, and exact cost", () => {
    const out = previewSms({
      template,
      schema,
      data: { name: "Ada", count: 2 },
      currency: "GHS",
    });
    expect(out.blockers).toEqual([]);
    expect(out.preview?.body).toBe("Hi Ada, you have 2 orders.");
    expect(out.preview?.encoding).toBe("gsm7");
    expect(out.preview?.segments).toBe(1);
    expect(out.preview?.cost_minor).toBe("3"); // 1 segment × 3 pesewas
    expect(out.preview?.currency).toBe("GHS");
  });

  it("blocks and renders nothing when the payload is invalid", () => {
    const out = previewSms({
      template,
      schema,
      data: { count: 2 }, // missing required name
      currency: "GHS",
    });
    expect(out.preview).toBeNull();
    expect(out.blockers).toContainEqual({
      path: "name",
      code: "missing_required",
    });
  });

  it("blocks a template token not declared in the schema", () => {
    const out = previewSms({
      template: "Hi {{name}} at {{company}}",
      schema,
      data: { name: "Ada" },
      currency: "GHS",
    });
    expect(out.preview).toBeNull();
    expect(out.blockers).toContainEqual({
      path: "company",
      code: "unknown_token",
    });
  });

  it("preview render/encoding/segments/cost match a direct send-style computation (parity)", () => {
    const data = { name: "Ada", count: 12 };
    const out = previewSms({ template, schema, data, currency: "GHS" });
    // The same body a send would build, run through the same pure send-path primitives.
    const expectedBody = "Hi Ada, you have 12 orders.";
    const seg = encodeAndSegment(expectedBody);
    expect(out.preview).toEqual({
      body: expectedBody,
      encoding: seg.encoding,
      length: seg.length,
      segments: seg.segments,
      cost_minor: rateSegments(seg.segments, "GHS").toString(),
      currency: "GHS",
    });
  });

  it("switches to ucs2 and multiple segments for non-GSM7 content", () => {
    const out = previewSms({
      template: "{{name}}",
      schema: { type: "object", properties: { name: { type: "string" } } },
      data: { name: "😀".repeat(40) },
      currency: "GHS",
    });
    expect(out.preview?.encoding).toBe("ucs2");
    expect(out.preview?.segments).toBeGreaterThan(1);
  });
});
