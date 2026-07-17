import { describe, expect, it } from "vitest";
import { buildLocales } from "./localized-variants-editor";

describe("localized definition authoring", () => {
  it("builds trimmed additional locale content", () => {
    expect(
      buildLocales(
        [{ id: "fr", locale: "fr", body: " Bonjour {{name}} " }],
        "en",
      ),
    ).toEqual({
      value: { fr: { body: "Bonjour {{name}}" } },
      error: null,
    });
  });

  it("rejects the default locale and duplicates", () => {
    expect(
      buildLocales([{ id: "en", locale: "en", body: "Hello" }], "en").error,
    ).toContain("default locale");
    expect(
      buildLocales(
        [
          { id: "1", locale: "fr", body: "Bonjour" },
          { id: "2", locale: "fr", body: "Salut" },
        ],
        "en",
      ).error,
    ).toContain("more than once");
  });
});
