import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isEntrypoint } from "./cloud-migrate.js";

describe("cloud migration entrypoint detection", () => {
  it("recognizes the same module through a resolved filesystem path", () => {
    expect(isEntrypoint(import.meta.url, fileURLToPath(import.meta.url))).toBe(
      true,
    );
  });

  it("fails closed for missing and invalid invocation paths", () => {
    expect(isEntrypoint(import.meta.url, undefined)).toBe(false);
    expect(isEntrypoint(import.meta.url, "not-a-real-entrypoint.js")).toBe(
      false,
    );
  });
});
