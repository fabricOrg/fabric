import { describe, expect, it } from "vitest";
import { definitionCatalogManifest } from "./definition-catalog.js";

describe("definition catalog contract", () => {
  it("accepts a content-free, environment-specific manifest", () => {
    const parsed = definitionCatalogManifest.parse({
      manifest_version: 1,
      minimum_sdk_contract_version: 1,
      minimum_cli_contract_version: 1,
      application: { id: "9c2397d1-8b51-47bb-b3ea-15d122fab832" },
      environment: {
        id: "f90516e4-d8d4-4203-85ee-0ed2db628f4a",
        type: "sandbox",
      },
      compatibility_digest: "a".repeat(64),
      definitions: [
        {
          key: "order.shipped",
          version: 2,
          channels: ["sms"],
          default_locale: "en",
          locales: ["en", "fr"],
          data_schema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("body");
    expect(JSON.stringify(parsed)).not.toContain("sender");
  });

  it("rejects a future manifest version", () => {
    expect(
      definitionCatalogManifest.safeParse({ manifest_version: 2 }).success,
    ).toBe(false);
  });
});
