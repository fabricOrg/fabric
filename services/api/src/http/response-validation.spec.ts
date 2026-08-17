import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkPayload, resolveValidationMode } from "./response-validation.js";

/**
 * The posture matters more than the mechanism. A validator that throws in production would turn our
 * own schema bug into a customer-facing 500; one that only warns in development would let the
 * published reference drift from the payload, which is the whole failure this replaces.
 */

describe("resolveValidationMode", () => {
  it("is STRICT outside production, so a mismatch is found while someone is looking", () => {
    expect(resolveValidationMode({ NODE_ENV: "development" })).toBe("strict");
    expect(resolveValidationMode({ NODE_ENV: "test" })).toBe("strict");
    expect(resolveValidationMode({})).toBe("strict");
  });

  it("is WARN in production — our schema bug must not 500 a working response", () => {
    expect(resolveValidationMode({ NODE_ENV: "production" })).toBe("warn");
  });

  it("honours an explicit override in either direction", () => {
    expect(
      resolveValidationMode({
        NODE_ENV: "production",
        OPENAPI_RESPONSE_VALIDATION: "strict",
      }),
    ).toBe("strict");
    expect(
      resolveValidationMode({
        NODE_ENV: "development",
        OPENAPI_RESPONSE_VALIDATION: "off",
      }),
    ).toBe("off");
  });

  it("ignores an unrecognised value rather than silently disabling itself", () => {
    // A typo'd mode must not read as "off". Falling back to the environment default keeps a
    // fat-fingered deploy variable from quietly turning the guarantee off.
    expect(
      resolveValidationMode({
        NODE_ENV: "development",
        OPENAPI_RESPONSE_VALIDATION: "disabled",
      }),
    ).toBe("strict");
  });
});

describe("checkPayload", () => {
  const contract = z.object({ id: z.string(), count: z.number() });

  it("passes a payload that matches", () => {
    expect(checkPayload(contract, { id: "a", count: 1 }, "R")).toBeNull();
  });

  it("reports a payload that does not, naming the field", () => {
    const failure = checkPayload(contract, { id: "a", count: "1" }, "R");
    expect(failure?.route).toBe("R");
    expect(failure?.issues).toContain("count");
  });

  it("reports a MISSING field — the case a hand-written spec always gets wrong", () => {
    const failure = checkPayload(contract, { id: "a" }, "R");
    expect(failure?.issues).toContain("count");
  });

  it("does nothing when the route has no contract, rather than inventing one", () => {
    expect(checkPayload(null, { anything: true }, "R")).toBeNull();
  });

  it("ignores an empty body — a 204 has nothing to check", () => {
    expect(checkPayload(contract, undefined, "R")).toBeNull();
    expect(checkPayload(contract, null, "R")).toBeNull();
  });

  it("OBSERVES rather than rewrites — an extra field is not stripped from the payload", () => {
    // zod's parse output would drop `extra`. Serving that output would silently truncate a response
    // whose contract is merely out of date, turning a documentation gap into data loss.
    const payload = { id: "a", count: 1, extra: "kept" };
    expect(checkPayload(contract, payload, "R")).toBeNull();
    expect(payload.extra).toBe("kept");
  });

  it("caps the reported issues so one bad list cannot flood a log line", () => {
    const wide = z.object(
      Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`f${i}`, z.string()]),
      ),
    );
    const failure = checkPayload(wide, {}, "R");
    expect(failure?.issues.split(";").length).toBeLessThanOrEqual(5);
  });
});
