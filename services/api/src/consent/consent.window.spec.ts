import { describe, expect, it } from "vitest";
import { promoWindowOpen } from "./consent.service.js";

// The promotional window is a pure function of (clock, country) — tests own time entirely.
// NCC 2442: 08:00-20:00 local; GH = UTC+0, NG (WAT) = UTC+1.
const at = (utcHour: number) => new Date(Date.UTC(2026, 6, 10, utcHour, 30));

describe("promoWindowOpen (E10-S5 quiet hours)", () => {
  it("opens 08:00 and closes 20:00 local for Ghana (UTC+0)", () => {
    expect(promoWindowOpen(at(7), "GH")).toBe(false);
    expect(promoWindowOpen(at(8), "GH")).toBe(true);
    expect(promoWindowOpen(at(19), "GH")).toBe(true);
    expect(promoWindowOpen(at(20), "GH")).toBe(false);
    expect(promoWindowOpen(at(23), "GH")).toBe(false);
  });

  it("shifts one hour for Nigeria (WAT, UTC+1)", () => {
    // 07:30 UTC = 08:30 WAT → open in NG while still closed in GH.
    expect(promoWindowOpen(at(7), "NG")).toBe(true);
    expect(promoWindowOpen(at(7), "GH")).toBe(false);
    // 19:30 UTC = 20:30 WAT → closed in NG while still open in GH.
    expect(promoWindowOpen(at(19), "NG")).toBe(false);
    expect(promoWindowOpen(at(19), "GH")).toBe(true);
  });
});
