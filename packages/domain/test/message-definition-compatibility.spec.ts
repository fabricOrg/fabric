import type { VariableSchema } from "@app/contracts";
import { describe, expect, it } from "vitest";
import {
  analyzeCompatibility,
  analyzeDefinitionCompatibility,
} from "../src/message-definition-compatibility.js";

// A base released schema reused across cases.
const base: VariableSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    count: { type: "integer", minimum: 0, maximum: 100 },
    tags: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
  required: ["id"],
  additionalProperties: false,
};

function verdict(next: VariableSchema) {
  return analyzeCompatibility(base, next).verdict;
}

describe("analyzeCompatibility (SDK-003 slice-0 §3)", () => {
  it("identical schema is compatible", () => {
    expect(verdict(structuredClone(base))).toBe("compatible");
  });

  it("adding an optional property is compatible", () => {
    const next = structuredClone(base);
    next.properties.note = { type: "string" };
    expect(verdict(next)).toBe("compatible");
  });

  it("adding a required property is breaking", () => {
    const next = structuredClone(base);
    next.properties.note = { type: "string" };
    next.required = ["id", "note"];
    const r = analyzeCompatibility(base, next);
    expect(r.verdict).toBe("breaking");
    expect(r.breaking[0]).toMatchObject({
      path: "note",
      code: "required_property_added",
    });
  });

  it("removing a property is breaking", () => {
    const next = structuredClone(base);
    delete next.properties.count;
    const r = analyzeCompatibility(base, next);
    expect(r.verdict).toBe("breaking");
    expect(r.breaking).toContainEqual({
      path: "count",
      code: "property_removed",
    });
  });

  it("changing a property type is breaking", () => {
    const next = structuredClone(base);
    next.properties.id = { type: "integer" };
    expect(analyzeCompatibility(base, next).breaking).toContainEqual({
      path: "id",
      code: "type_changed",
    });
  });

  it("making an optional property required is breaking", () => {
    const next = structuredClone(base);
    next.required = ["id", "count"];
    expect(analyzeCompatibility(base, next).breaking).toContainEqual({
      path: "count",
      code: "made_required",
    });
  });

  it("making a required property optional is compatible", () => {
    const next = structuredClone(base);
    next.required = [];
    expect(verdict(next)).toBe("compatible");
  });

  it("narrowing a numeric maximum is breaking; widening is compatible", () => {
    const narrower = structuredClone(base);
    narrower.properties.count = { type: "integer", minimum: 0, maximum: 50 };
    expect(verdict(narrower)).toBe("breaking");

    const wider = structuredClone(base);
    wider.properties.count = { type: "integer", minimum: 0, maximum: 1000 };
    expect(verdict(wider)).toBe("compatible");
  });

  it("shrinking an enum is breaking; growing it is compatible", () => {
    const released: VariableSchema = {
      type: "object",
      properties: { kind: { type: "string", enum: ["a", "b"] } },
    };
    const shrunk: VariableSchema = {
      type: "object",
      properties: { kind: { type: "string", enum: ["a"] } },
    };
    const grown: VariableSchema = {
      type: "object",
      properties: { kind: { type: "string", enum: ["a", "b", "c"] } },
    };
    expect(analyzeCompatibility(released, shrunk).verdict).toBe("breaking");
    expect(analyzeCompatibility(released, grown).verdict).toBe("compatible");
  });

  it("adding a format is breaking (restricts accepted input)", () => {
    const next = structuredClone(base);
    next.properties.id = { type: "string", format: "uuid" };
    expect(verdict(next)).toBe("breaking");
  });

  it("lowering an array maxItems is breaking", () => {
    const next = structuredClone(base);
    next.properties.tags = {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    };
    expect(verdict(next)).toBe("breaking");
  });

  it("reports the nested path of a breaking change", () => {
    const released: VariableSchema = {
      type: "object",
      properties: {
        addr: { type: "object", properties: { zip: { type: "string" } } },
      },
    };
    const next: VariableSchema = {
      type: "object",
      properties: {
        addr: { type: "object", properties: { zip: { type: "integer" } } },
      },
    };
    expect(analyzeCompatibility(released, next).breaking).toContainEqual({
      path: "addr.zip",
      code: "type_changed",
    });
  });
});

describe("definition locale compatibility", () => {
  it("allows a locale to be added", () => {
    expect(
      analyzeDefinitionCompatibility(
        base,
        base,
        ["en"],
        ["en", "fr"],
        "sms",
        "sms",
      ).verdict,
    ).toBe("compatible");
  });

  it("requires a new key when a locale is removed", () => {
    expect(
      analyzeDefinitionCompatibility(
        base,
        base,
        ["en", "fr"],
        ["en"],
        "sms",
        "sms",
      ).breaking,
    ).toContainEqual({
      path: "content.locales.fr",
      code: "locale_removed",
    });
  });
});

describe("definition channel compatibility (ADR-0005 Amendment A1)", () => {
  it("same channel is compatible", () => {
    expect(
      analyzeDefinitionCompatibility(base, base, ["en"], ["en"], "sms", "sms")
        .verdict,
    ).toBe("compatible");
  });

  it("changing the channel requires a new key", () => {
    const result = analyzeDefinitionCompatibility(
      base,
      base,
      ["en"],
      ["en"],
      "sms",
      "email",
    );
    expect(result.verdict).toBe("breaking");
    expect(result.breaking).toContainEqual({
      path: "channel",
      code: "channel_removed",
    });
  });
});
