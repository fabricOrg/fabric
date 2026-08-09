import { describe, expect, it } from "vitest";
import { templateShape } from "./whatsapp-template-shape.js";

describe("templateShape", () => {
  it("counts positional body placeholders", () => {
    expect(
      templateShape([
        { type: "HEADER", text: "Order {{1}}" },
        { type: "BODY", text: "Hi {{1}}, your order {{2}} is on its way." },
        { type: "FOOTER", text: "Jasper's Market" },
      ]),
    ).toEqual({
      // HEADER placeholders are a separate parameter list on Meta's side; only BODY is counted here
      // because only BODY is what our send supplies.
      variableCount: 2,
      bodyPreview: "Hi {{1}}, your order {{2}} is on its way.",
    });
  });

  it("takes the HIGHEST index, not the number of distinct tokens", () => {
    // A gap is an authoring artefact, and Meta still expects an array long enough for {{3}}. Counting
    // distinct tokens would under-supply and fail at the provider, after the reserve.
    expect(
      templateShape([{ type: "BODY", text: "{{1}} then {{3}}" }]).variableCount,
    ).toBe(3);
    // A repeat is one parameter used twice, not two.
    expect(
      templateShape([{ type: "BODY", text: "{{1}} and {{1}}" }]).variableCount,
    ).toBe(1);
  });

  it("reports zero for a body with no placeholders", () => {
    expect(templateShape([{ type: "BODY", text: "Welcome!" }])).toEqual({
      variableCount: 0,
      bodyPreview: "Welcome!",
    });
  });

  it("tolerates whitespace inside the braces", () => {
    expect(
      templateShape([{ type: "BODY", text: "Hi {{ 1 }}" }]).variableCount,
    ).toBe(1);
  });

  it("accepts lowercase component types — the payload is Meta's, not ours", () => {
    expect(
      templateShape([{ type: "body", text: "Hi {{1}}" }]).variableCount,
    ).toBe(1);
  });

  it("degrades to empty rather than throwing on a shape it does not model", () => {
    // Never throw here: a template we cannot parse must still be listable, or one odd row in the
    // catalog would take out the whole picker.
    for (const raw of [
      null,
      undefined,
      {},
      [],
      "nonsense",
      [{ type: "BODY" }],
    ]) {
      expect(templateShape(raw)).toEqual({
        variableCount: 0,
        bodyPreview: null,
      });
    }
  });
});
