import type { VariableSchema } from "@app/contracts";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHATSAPP_BASE_RATES,
  previewWhatsapp,
  rateWhatsappFlat,
  UnknownCurrencyError,
  WHATSAPP_PARAMETER_MAX_CHARS,
} from "../src/index.js";

const schema: VariableSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    count: { type: "integer", minimum: 0 },
  },
  required: ["name", "count"],
};

function preview(data: unknown, parameters = ["name", "count"]) {
  return previewWhatsapp({
    templateName: "order_shipped",
    templateLanguage: "en_US",
    templateCategory: "utility",
    parameters,
    schema,
    data,
    currency: "GHS",
  });
}

describe("previewWhatsapp (ADR-0014)", () => {
  it("resolves parameters positionally, in the definition's order", () => {
    const { blockers, preview: result } = preview({ name: "Ada", count: 2 });
    expect(blockers).toEqual([]);
    expect(result?.parameters).toEqual(["Ada", "2"]);
  });

  it("reverses with the declared order, not with the payload's key order", () => {
    // The whole reason `parameters` is an ordered array: Meta body params carry no names on the wire,
    // so this array is the only thing deciding which value lands in which placeholder.
    const { preview: result } = preview({ count: 2, name: "Ada" }, [
      "count",
      "name",
    ]);
    expect(result?.parameters).toEqual(["2", "Ada"]);
  });

  it("blocks an undeclared parameter instead of sending an empty one", () => {
    const { blockers, preview: result } = preview({ name: "Ada", count: 2 }, [
      "name",
      "nickname",
    ]);
    expect(blockers).toEqual([{ path: "parameters.1", code: "unknown_token" }]);
    expect(result).toBeNull();
  });

  it.each([
    ["a newline", "Ada\nBaker"],
    ["a tab", "Ada\tBaker"],
    ["five spaces", "Ada     Baker"],
  ])("blocks %s — Meta rejects the whole message on it", (_label, value) => {
    const { blockers, preview: result } = preview({ name: value, count: 2 });
    expect(blockers).toEqual([
      { path: "parameters.0", code: "parameter_whitespace" },
    ]);
    expect(result).toBeNull();
  });

  it("allows four consecutive spaces — the limit is more than four", () => {
    const { blockers } = preview({ name: "Ada    Baker", count: 2 });
    expect(blockers).toEqual([]);
  });

  it("blocks a parameter past Meta's per-parameter ceiling", () => {
    const { blockers } = preview({
      name: "x".repeat(WHATSAPP_PARAMETER_MAX_CHARS + 1),
      count: 2,
    });
    expect(blockers).toEqual([
      { path: "parameters.0", code: "parameter_too_long" },
    ]);
  });

  it("never echoes the rejected value in a blocker", () => {
    const { blockers } = preview({ name: "Ada\nsecret-value", count: 2 });
    expect(JSON.stringify(blockers)).not.toContain("secret-value");
  });

  it("prices flat per message and rejects an unpriced currency", () => {
    expect(rateWhatsappFlat("GHS")).toBe(DEFAULT_WHATSAPP_BASE_RATES.GHS);
    // Never silently charge zero — the same rule rateSegments and rateEmailFlat hold.
    expect(() => rateWhatsappFlat("EUR")).toThrow(UnknownCurrencyError);
  });
});
