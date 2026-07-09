import type { Money } from "@app/contracts";
import { describe, expect, it } from "vitest";
import { formatMoney } from "./money.js";

/**
 * Money formatting — unit spec (finding A2). The staff console shows tenant balances/adjustments;
 * formatting is exact integer math on minor units (never float), code-prefixed per the design spec.
 */
const ghs = (minor: string): Money => ({ currency: "GHS", minor });

describe("formatMoney", () => {
  it("formats whole + fractional minor units with grouping", () => {
    expect(formatMoney(ghs("120403"))).toBe("GHS 1,204.03");
  });

  it("pads the fractional part", () => {
    expect(formatMoney(ghs("1500"))).toBe("GHS 15.00");
    expect(formatMoney(ghs("5"))).toBe("GHS 0.05");
  });

  it("handles zero", () => {
    expect(formatMoney(ghs("0"))).toBe("GHS 0.00");
  });

  it("prefixes negatives with a single minus", () => {
    expect(formatMoney(ghs("-500"))).toBe("-GHS 5.00");
  });

  it("is exact for large amounts (no float rounding)", () => {
    // 9,999,999,999.99 — well past Number.MAX_SAFE_INTEGER in minor units.
    expect(formatMoney(ghs("999999999999"))).toBe("GHS 9,999,999,999.99");
  });
});
