import { describe, expect, it } from "vitest";
import { promoWindowOpen } from "./consent.service.js";

// The promotional window is a pure function of (clock, country) — tests own time entirely.
// Strictest-reading posture (docs/PI-4/GHANA-NCA-FINDINGS.md):
//   NG (NCC 2442): 08:00–20:00 WAT (UTC+1), any day.
//   GH (NCA UEC):  08:00–19:00 UTC+0, NO Sundays.
// 2026-07-10 is a Friday; 2026-07-12 is a Sunday.
const friday = (utcHour: number) =>
  new Date(Date.UTC(2026, 6, 10, utcHour, 30));
const sunday = (utcHour: number) =>
  new Date(Date.UTC(2026, 6, 12, utcHour, 30));

describe("promoWindowOpen (E10-S5/S6 quiet hours)", () => {
  it("Ghana: opens 08:00, closes 19:00 local (UTC+0)", () => {
    expect(promoWindowOpen(friday(7), "GH")).toBe(false);
    expect(promoWindowOpen(friday(8), "GH")).toBe(true);
    expect(promoWindowOpen(friday(18), "GH")).toBe(true);
    expect(promoWindowOpen(friday(19), "GH")).toBe(false);
    expect(promoWindowOpen(friday(23), "GH")).toBe(false);
  });

  it("Ghana: Sundays are fully closed for promotional traffic (NCA UEC)", () => {
    expect(promoWindowOpen(sunday(10), "GH")).toBe(false);
    expect(promoWindowOpen(sunday(10), "NG")).toBe(true); // NG has no Sunday rule
  });

  it("Nigeria: 08:00–20:00 WAT (UTC+1), one hour shifted from UTC", () => {
    expect(promoWindowOpen(friday(6), "NG")).toBe(false); // 07:30 WAT
    expect(promoWindowOpen(friday(7), "NG")).toBe(true); // 08:30 WAT
    expect(promoWindowOpen(friday(18), "NG")).toBe(true); // 19:30 WAT
    expect(promoWindowOpen(friday(19), "NG")).toBe(false); // 20:30 WAT
  });
});
