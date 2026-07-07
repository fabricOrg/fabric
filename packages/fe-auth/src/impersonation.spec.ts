import { describe, expect, it } from "vitest";
import { readImpersonation, sealImpersonation } from "./impersonation.js";
import type { ImpersonationClaim } from "./index.js";

const PASSWORD = "impersonation-cookie-password-0123456789";
const NOW = 1_800_000_000_000;

function claim(
  overrides: Partial<ImpersonationClaim> = {},
): ImpersonationClaim {
  return {
    targetTenantId: "11111111-1111-1111-1111-111111111111",
    targetLabel: "KwikGH",
    reason: "Debug DLR reconciliation",
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

describe("impersonation claim seal", () => {
  it("round-trips a sealed claim", () => {
    const sealed = sealImpersonation(PASSWORD, claim());
    expect(readImpersonation(PASSWORD, sealed, NOW)).toEqual(claim());
  });

  it("fails closed once expired", () => {
    const sealed = sealImpersonation(PASSWORD, claim({ expiresAt: NOW - 1 }));
    expect(readImpersonation(PASSWORD, sealed, NOW)).toBeNull();
  });

  it("fails closed on a wrong password", () => {
    const sealed = sealImpersonation(PASSWORD, claim());
    expect(
      readImpersonation("a-totally-different-password-0123456789", sealed, NOW),
    ).toBeNull();
  });

  it("fails closed on tampering", () => {
    const sealed = sealImpersonation(PASSWORD, claim());
    const tampered = `${sealed.slice(0, -3)}xyz`;
    expect(readImpersonation(PASSWORD, tampered, NOW)).toBeNull();
  });

  it("rejects a short password", () => {
    expect(() => sealImpersonation("too-short", claim())).toThrow();
  });
});
