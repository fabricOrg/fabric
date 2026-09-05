import { verifyStartRequest } from "@app/contracts";
import { describe, expect, it } from "vitest";

/**
 * The contract-level half of ADR-0017 §1a. What is pinned here is the boundary rule that must hold before any of
 * that runs — a caller cannot supply the code. The renderer's own rules are in
 * verify-render.spec.ts.
 */
describe("verify start request", () => {
  const base = { to: "+233545227189" };

  it("accepts a template with caller variables", () => {
    const parsed = verifyStartRequest.safeParse({
      ...base,
      template: "merchant.otp",
      variables: { platform: "Convert", merchant: "Kofi Stores" },
      locale: "en",
    });
    expect(parsed.success).toBe(true);
  });

  // The security boundary. Silently dropping a caller-supplied `code` would let an integrator
  // believe they had set the OTP, which is worse than refusing: they would ship it.
  it.each(["code", "expires_minutes", "expires_seconds"])(
    "refuses a caller-supplied reserved variable: %s",
    (name) => {
      const parsed = verifyStartRequest.safeParse({
        ...base,
        template: "merchant.otp",
        variables: { [name]: "000000" },
      });
      expect(parsed.success).toBe(false);
      expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual([
        "variables",
      ]);
    },
  );

  it("refuses variables without a template, which would silently do nothing", () => {
    const parsed = verifyStartRequest.safeParse({
      ...base,
      variables: { platform: "Convert" },
    });
    expect(parsed.success).toBe(false);
  });

  // Backwards compatibility: every existing caller sends exactly this and must keep working.
  it("still accepts the original two-field request", () => {
    expect(verifyStartRequest.safeParse(base).success).toBe(true);
    expect(
      verifyStartRequest.safeParse({ ...base, sender_id: "AKWAAH" }).success,
    ).toBe(true);
  });

  it("rejects an unknown field rather than ignoring it", () => {
    expect(
      verifyStartRequest.safeParse({ ...base, tempalte: "typo" }).success,
    ).toBe(false);
  });
});
