import { describe, expect, it } from "vitest";
import { generateCatalog } from "./generate.js";
import { parseManifest } from "./manifest.js";

function manifest() {
  return parseManifest({
    manifest_version: 1,
    minimum_sdk_contract_version: 1,
    minimum_cli_contract_version: 1,
    application: { id: "96b52b90-3f8c-4a98-8f23-a4db76585c67" },
    environment: {
      id: "daf33432-f40a-48ba-8fc7-cead9853ec0d",
      type: "sandbox",
    },
    compatibility_digest: "d".repeat(64),
    definitions: [
      {
        key: "order.shipped",
        version: 1,
        channels: ["sms"],
        default_locale: "en",
        locales: ["fr", "en"],
        data_schema: {
          type: "object",
          properties: {
            note: { type: "string" },
            count: { type: "integer" },
            name: { type: "string" },
          },
          required: ["name", "count"],
          additionalProperties: false,
        },
      },
    ],
  });
}

describe("catalog generator", () => {
  it("emits deterministic exact TypeScript without operational identifiers", () => {
    const first = generateCatalog(manifest());
    const second = generateCatalog(manifest());
    expect(first).toBe(second);
    expect(first).toContain('readonly "order.shipped"');
    expect(first).toContain('readonly "count": number');
    expect(first).toContain('readonly "note"?: string');
    expect(first).toContain('readonly locales: "en" | "fr"');
    expect(first).not.toMatch(/96b52b90|daf33432|sender|provider|body/);
  });

  it("fails closed on a newer manifest with upgrade guidance", () => {
    expect(() => parseManifest({ manifest_version: 2 })).toThrow(
      /newer @fabric-messaging\/cli/,
    );
  });

  it("fails before generation when the installed SDK contract is too old", () => {
    expect(() =>
      parseManifest({
        ...manifest(),
        minimum_sdk_contract_version: 2,
      }),
    ).toThrow(/Upgrade @fabric-messaging\/sdk/);
  });
});
