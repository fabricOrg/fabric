import { describe, expect, it } from "vitest";
import {
  createMessageDefinitionRequest,
  localeTag,
  smsVariantContent,
  stableKey,
  variableSchema,
} from "./message-definitions.js";

describe("stable key grammar (SDK-003 slice-0 §1)", () => {
  it.each([
    "order",
    "order.shipped",
    "order.item-shipped",
    "a.b.c.d",
  ])("accepts %s", (k) => {
    expect(stableKey.safeParse(k).success).toBe(true);
  });

  it.each([
    "Order.Shipped", // uppercase
    "fabric.system", // reserved prefix
    "-leading", // leading hyphen
    "order..shipped", // double dot
    "order.", // trailing dot
    "a.b.c.d.e.f.g.h.i", // 9 segments (>8)
    `${"a".repeat(129)}`, // >128 chars
  ])("rejects %s", (k) => {
    expect(stableKey.safeParse(k).success).toBe(false);
  });
});

describe("localized SMS variants", () => {
  it("accepts bounded locale tags and fills empty locale content", () => {
    expect(localeTag.safeParse("en-GH").success).toBe(true);
    expect(
      smsVariantContent.parse({ body: "Hello", class: "transactional" }),
    ).toEqual({ body: "Hello", class: "transactional", locales: {} });
  });

  it("rejects invalid locale keys", () => {
    expect(
      smsVariantContent.safeParse({
        body: "Hello",
        locales: { english: { body: "Hello" } },
      }).success,
    ).toBe(false);
  });

  it("rejects duplicating the default locale in the variants map", () => {
    expect(
      createMessageDefinitionRequest.safeParse({
        key: "order.shipped",
        variable_schema: { type: "object", properties: {} },
        content: {
          body: "Hello",
          class: "transactional",
          locales: { en: { body: "Hello again" } },
        },
        default_locale: "en",
        sender_id: "FABRIC",
      }).success,
    ).toBe(false);
  });
});

const validSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    count: { type: "integer", minimum: 0 },
    kind: { type: "string", enum: ["a", "b"] },
    tags: { type: "array", items: { type: "string" }, maxItems: 10 },
    nested: {
      type: "object",
      properties: { flag: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

describe("variable-schema subset (SDK-003 slice-0 §2)", () => {
  it("accepts a valid closed object schema", () => {
    expect(variableSchema.safeParse(validSchema).success).toBe(true);
  });

  it("rejects a non-object root", () => {
    expect(variableSchema.safeParse({ type: "string" }).success).toBe(false);
  });

  it("rejects an array without maxItems (unbounded)", () => {
    const s = {
      type: "object",
      properties: { xs: { type: "array", items: { type: "string" } } },
    };
    expect(variableSchema.safeParse(s).success).toBe(false);
  });

  it("rejects unknown/forbidden keys ($ref, oneOf, patternProperties)", () => {
    for (const extra of [
      { $ref: "#/x" },
      { oneOf: [] },
      { patternProperties: {} },
    ]) {
      const s = { type: "object", properties: {}, ...extra };
      expect(
        variableSchema.safeParse(s).success,
        `must reject ${Object.keys(extra)[0]}`,
      ).toBe(false);
    }
  });

  it("rejects open objects (additionalProperties: true)", () => {
    const s = { type: "object", properties: {}, additionalProperties: true };
    expect(variableSchema.safeParse(s).success).toBe(false);
  });

  it("rejects an unknown string format", () => {
    const s = {
      type: "object",
      properties: { x: { type: "string", format: "credit-card" } },
    };
    expect(variableSchema.safeParse(s).success).toBe(false);
  });

  it("rejects an enum with more than 64 members", () => {
    const s = {
      type: "object",
      properties: {
        x: {
          type: "string",
          enum: Array.from({ length: 65 }, (_, i) => `v${i}`),
        },
      },
    };
    expect(variableSchema.safeParse(s).success).toBe(false);
  });

  it("rejects a string maxLength over the hard cap", () => {
    const s = {
      type: "object",
      properties: { x: { type: "string", maxLength: 5000 } },
    };
    expect(variableSchema.safeParse(s).success).toBe(false);
  });

  it("rejects more than 64 properties", () => {
    const properties: Record<string, { type: "boolean" }> = {};
    for (let i = 0; i < 65; i++) properties[`p${i}`] = { type: "boolean" };
    expect(
      variableSchema.safeParse({ type: "object", properties }).success,
    ).toBe(false);
  });

  it("rejects nesting deeper than 5", () => {
    // depth 6: object > object > object > object > object > object
    let node: unknown = { type: "object", properties: {} };
    for (let i = 0; i < 5; i++) {
      node = { type: "object", properties: { child: node } };
    }
    expect(variableSchema.safeParse(node).success).toBe(false);
  });

  it("rejects required naming an unknown property", () => {
    const s = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a", "ghost"],
    };
    expect(variableSchema.safeParse(s).success).toBe(false);
  });
});
