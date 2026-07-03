// ============================================================================================
// SEGMENT-COST PARITY GATE (PI-2 QA / adams) — the GOLDEN TRUTH TABLE for SMS segmentation + cost.
//
// WHY: the dashboard Send screen (L-D1) shows a LIVE segment/encoding + cost meter, and cost is
// money — it MUST equal the server-side canonical math (`@app/domain` encodeAndSegment + rateSegments/
// DEFAULT_RATES), with NO front-end re-implementation drift (F5.2: segment count determines cost and
// is never trusted from the client). This gate pins the canonical `(body) → {encoding,length,segments}`
// and `(segments,currency) → cost_minor` behavior as an exhaustive, boundary-covering table.
//
// TWO ROLES:
//   1. NOW — assert @app/domain matches the table (catches a regression in the source of truth).
//   2. LATER (when L-D1 lands) — the dashboard meter test drives the SAME `SEGMENT_VECTORS` through the
//      UI meter and asserts equality to `expected`, proving the FE reuses the domain fns (true parity).
//      → promote SEGMENT_VECTORS/COST_VECTORS to a shared export then; kept here until the meter exists.
//
// ASTRAL/EMOJI (RULED — msg 9ba4877a + 960cf074): fifi ruled code-point counting a BUG (under-bill +
// truncation). UCS-2 MUST count UTF-16 code units (str.length), concat 67, surrogate-safe boundary.
// Fix routed to newton as `fix/e5-ucs2-utf16-units`. Per fifi's interim call: this gate ships GREEN now
// (GSM-7 + BMP-UCS-2), and the ASTRAL_VECTORS below — built to the CORRECTED semantics — are held in a
// `describe.skip` so nothing merges red. FLIP LIVE (drop `.skip`) the moment newton's fix lands; they
// then become the belt keeping the FE meter == the fixed domain fn forever after.
// ============================================================================================

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATES,
  rateSegments,
  UnknownCurrencyError,
} from "../src/rating.js";
import { type Encoding, encodeAndSegment } from "../src/segmentation.js";

interface SegVector {
  name: string;
  body: string;
  encoding: Encoding;
  length: number;
  segments: number;
}

// GSM-7 single limit 160 / concat 153; UCS-2 (BMP) single 70 / concat 67. Empty = 1 segment.
// Every vector here is UNAMBIGUOUS: GSM-7 septets, or BMP UCS-2 where 1 code point == 1 UTF-16 unit
// (Chinese, Latin-extended) — so code-point counting and UTF-16 counting agree.
export const SEGMENT_VECTORS: readonly SegVector[] = [
  { name: "empty → 1 seg", body: "", encoding: "gsm7", length: 0, segments: 1 },
  {
    name: "short gsm7",
    body: "hello",
    encoding: "gsm7",
    length: 5,
    segments: 1,
  },
  {
    name: "gsm7 single-segment boundary (160)",
    body: "a".repeat(160),
    encoding: "gsm7",
    length: 160,
    segments: 1,
  },
  {
    name: "gsm7 just over → concat (161 → 2)",
    body: "a".repeat(161),
    encoding: "gsm7",
    length: 161,
    segments: 2,
  },
  {
    name: "gsm7 exact 2-segment concat (306 = 2×153)",
    body: "a".repeat(306),
    encoding: "gsm7",
    length: 306,
    segments: 2,
  },
  {
    name: "gsm7 into 3rd segment (307 → 3)",
    body: "a".repeat(307),
    encoding: "gsm7",
    length: 307,
    segments: 3,
  },
  {
    name: "gsm7 extension char costs 2 septets — 80×€ = 160 → 1 seg",
    body: "€".repeat(80),
    encoding: "gsm7",
    length: 160,
    segments: 1,
  },
  {
    name: "gsm7 extension straddle — 81×€ = 162 → 2 seg",
    body: "€".repeat(81),
    encoding: "gsm7",
    length: 162,
    segments: 2,
  },
  {
    name: "gsm7 extension pushes over 160 — 159×a + € = 161 → 2 seg",
    body: `${"a".repeat(159)}€`,
    encoding: "gsm7",
    length: 161,
    segments: 2,
  },
  {
    name: "gsm7 extension exactly fills 160 — 158×a + € = 160 → 1 seg",
    body: `${"a".repeat(158)}€`,
    encoding: "gsm7",
    length: 160,
    segments: 1,
  },
  {
    name: "one non-GSM BMP char forces UCS-2 (ł, U+0142)",
    body: "ł",
    encoding: "ucs2",
    length: 1,
    segments: 1,
  },
  {
    name: "UCS-2 BMP (Chinese) — 你好",
    body: "你好",
    encoding: "ucs2",
    length: 2,
    segments: 1,
  },
  {
    name: "UCS-2 single-segment boundary (70)",
    body: "你".repeat(70),
    encoding: "ucs2",
    length: 70,
    segments: 1,
  },
  {
    name: "UCS-2 just over → concat (71 → 2)",
    body: "你".repeat(71),
    encoding: "ucs2",
    length: 71,
    segments: 2,
  },
  {
    name: "UCS-2 exact 2-segment concat (134 = 2×67)",
    body: "你".repeat(134),
    encoding: "ucs2",
    length: 134,
    segments: 2,
  },
  {
    name: "UCS-2 into 3rd segment (135 → 3)",
    body: "你".repeat(135),
    encoding: "ucs2",
    length: 135,
    segments: 3,
  },
];

describe("segment parity — encodeAndSegment golden truth table", () => {
  for (const v of SEGMENT_VECTORS) {
    it(v.name, () => {
      expect(encodeAndSegment(v.body)).toEqual({
        encoding: v.encoding,
        length: v.length,
        segments: v.segments,
      });
    });
  }
});

// cost_minor = segments × per-segment rate (minor units, exact bigint — no float ever).
interface CostVector {
  name: string;
  segments: number;
  currency: string;
  expected: bigint;
}
export const COST_VECTORS: readonly CostVector[] = [
  { name: "1 seg GHS = 3 pesewas", segments: 1, currency: "GHS", expected: 3n },
  {
    name: "1 seg NGN = 400 kobo",
    segments: 1,
    currency: "NGN",
    expected: 400n,
  },
  { name: "1 seg USD = 1 cent", segments: 1, currency: "USD", expected: 1n },
  { name: "3 seg GHS = 9", segments: 3, currency: "GHS", expected: 9n },
  { name: "2 seg NGN = 800", segments: 2, currency: "NGN", expected: 800n },
  { name: "10 seg USD = 10", segments: 10, currency: "USD", expected: 10n },
];

describe("segment parity — rateSegments cost (exact minor units)", () => {
  for (const c of COST_VECTORS) {
    it(c.name, () => {
      expect(rateSegments(c.segments, c.currency)).toBe(c.expected);
    });
  }
  it("cost is exact bigint, never a JS number/float", () => {
    expect(typeof rateSegments(1, "GHS")).toBe("bigint");
  });
  it("rejects an unpriced currency (never silently charge 0)", () => {
    expect(() => rateSegments(1, "EUR")).toThrow(UnknownCurrencyError);
  });
  it("every DEFAULT_RATES currency is a positive bigint", () => {
    for (const [ccy, rate] of Object.entries(DEFAULT_RATES)) {
      expect(typeof rate, ccy).toBe("bigint");
      expect(rate > 0n, ccy).toBe(true);
    }
  });
  it("end-to-end: a 2-segment GHS message costs 6", () => {
    const seg = encodeAndSegment("a".repeat(200)).segments; // 200 gsm7 → 2 segments
    expect(seg).toBe(2);
    expect(rateSegments(seg, "GHS")).toBe(6n);
  });
});

// CORRECTED astral semantics (ruled msg 9ba4877a). 😀 = U+1F600 = a surrogate pair = 2 UTF-16 units.
// `length` MUST equal str.length (UTF-16 units). Segment counts chosen so they hold regardless of
// whether the surrogate-safe boundary carries 66 or 67 units/segment (both give the same answer here):
//   35×😀 = 70 units ≤ 70 → 1 seg · 36×😀 = 72 → 2 seg · 70×😀 = 140 → 3 seg.
// Held in describe.skip until newton's fix lands (fix/e5-ucs2-utf16-units); drop `.skip` to activate.
export const ASTRAL_VECTORS: readonly SegVector[] = [
  {
    name: "single emoji forces UCS-2, counts 2 UTF-16 units",
    body: "😀",
    encoding: "ucs2",
    length: 2,
    segments: 1,
  },
  {
    name: "mixed text + emoji counts UTF-16 units (hello␠😀 = 8)",
    body: "hello 😀",
    encoding: "ucs2",
    length: 8,
    segments: 1,
  },
  {
    name: "35×😀 = 70 UTF-16 units → 1 seg (boundary)",
    body: "😀".repeat(35),
    encoding: "ucs2",
    length: 70,
    segments: 1,
  },
  {
    name: "36×😀 = 72 UTF-16 units → 2 seg (was 1 — the under-bill)",
    body: "😀".repeat(36),
    encoding: "ucs2",
    length: 72,
    segments: 2,
  },
  {
    name: "70×😀 = 140 UTF-16 units → 3 seg (was 1 — bills 1, sends 3)",
    body: "😀".repeat(70),
    encoding: "ucs2",
    length: 140,
    segments: 3,
  },
];

// LIVE (fix/e5-ucs2-utf16-units landed): the parity belt keeping the FE meter == the fixed domain fn.
describe("segment parity — astral/emoji UTF-16-unit semantics", () => {
  for (const v of ASTRAL_VECTORS) {
    it(v.name, () => {
      expect(encodeAndSegment(v.body)).toEqual({
        encoding: v.encoding,
        length: v.length,
        segments: v.segments,
      });
    });
  }
});
