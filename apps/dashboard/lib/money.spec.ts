// ============================================================================================
// MONEY-EXACTNESS GATE (PI-2 QA / adams) — the dashboard renders money EXACTLY, never via float.
//
// F-money convention: amounts travel as MINOR units in a STRING (bigint doesn't survive JSON), so the
// UI must parse BigInt and format with integer math — never `Number(minor)/100` which rounds past
// 2^53. This gate pins `formatMoney`/`formatSigned` (apps/dashboard/lib/money.ts) to exact output,
// including a value BEYOND the float-safe integer range — the assertion a float impl cannot pass.
// Ties to the segment-parity cost table (segments × rate) and the browser-gate money-exactness check.
// ============================================================================================

import type { Money } from "@app/contracts";
import { describe, expect, it } from "vitest";
import { formatMoney, formatSigned } from "./money";

const ghs = (minor: string): Money => ({ currency: "GHS", minor });

describe("formatMoney — exact minor-unit rendering (no float)", () => {
  const cases: Array<[Money, string]> = [
    [{ currency: "GHS", minor: "120403" }, "GHS 1,204.03"], // the Overview balance
    [{ currency: "GHS", minor: "3" }, "GHS 0.03"], // 1 SMS segment
    [{ currency: "GHS", minor: "6" }, "GHS 0.06"], // 2 segments
    [{ currency: "GHS", minor: "0" }, "GHS 0.00"],
    [{ currency: "GHS", minor: "100" }, "GHS 1.00"],
    [{ currency: "GHS", minor: "99" }, "GHS 0.99"],
    [{ currency: "GHS", minor: "-500" }, "-GHS 5.00"], // negative (refund/adjustment)
    [{ currency: "NGN", minor: "400" }, "NGN 4.00"], // 1 segment NGN
    [{ currency: "NGN", minor: "1234567" }, "NGN 12,345.67"],
    [{ currency: "USD", minor: "1" }, "USD 0.01"],
    [{ currency: "USD", minor: "100000" }, "USD 1,000.00"],
  ];
  for (const [m, expected] of cases) {
    it(`${m.currency} ${m.minor} → ${expected}`, () => {
      expect(formatMoney(m)).toBe(expected);
    });
  }

  // THE money-exactness proof: 90071992547409910 minor = 900,719,925,474,099.10 major. The whole part
  // (900719925474099) exceeds Number.MAX_SAFE_INTEGER (9007199254740991), so any `Number(minor)/100`
  // implementation loses precision here. BigInt integer math must render it digit-exact.
  it("is exact BEYOND the float-safe integer range (bigint, not Number/100)", () => {
    expect(formatMoney(ghs("90071992547409910"))).toBe(
      "GHS 900,719,925,474,099.10",
    );
    // sanity: the naive float path would NOT reproduce this string
    const floatPath = (Number("90071992547409910") / 100).toFixed(2);
    expect(floatPath).not.toBe("900719925474099.10");
  });

  it("fraction is zero-padded to the currency's decimals (never a bare tenth)", () => {
    expect(formatMoney(ghs("5"))).toBe("GHS 0.05"); // not "GHS 0.5"
    expect(formatMoney(ghs("50"))).toBe("GHS 0.50");
  });
});

describe("formatSigned — ledger credit/debit display", () => {
  it("credit prefixes + and debit prefixes - , amount always the magnitude", () => {
    expect(formatSigned({ currency: "GHS", minor: "5000" }, "credit")).toBe(
      "+GHS 50.00",
    );
    expect(formatSigned(ghs("3"), "debit")).toBe("-GHS 0.03");
  });
  it("a minor already carrying a leading '-' is not double-signed", () => {
    expect(formatSigned(ghs("-3"), "debit")).toBe("-GHS 0.03");
    expect(formatSigned(ghs("-5000"), "credit")).toBe("+GHS 50.00");
  });
});
