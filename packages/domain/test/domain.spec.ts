import { describe, expect, it } from "vitest";
import { decideResolution } from "../src/billing.js";
import { rateSegments, UnknownCurrencyError } from "../src/rating.js";
import { encodeAndSegment } from "../src/segmentation.js";

describe("encodeAndSegment", () => {
  it("GSM-7 single segment up to 160 chars", () => {
    expect(encodeAndSegment("hello")).toEqual({
      encoding: "gsm7",
      length: 5,
      segments: 1,
    });
    expect(encodeAndSegment("a".repeat(160)).segments).toBe(1);
    expect(encodeAndSegment("a".repeat(161))).toMatchObject({
      encoding: "gsm7",
      segments: 2,
    }); // 153/seg
  });

  it("GSM-7 extension chars cost 2 septets", () => {
    // '€' is a GSM-7 extension char → 2 septets; 80 of them = 160 septets = still 1 segment, 81 = 2.
    expect(encodeAndSegment("€".repeat(80)).segments).toBe(1);
    expect(encodeAndSegment("€".repeat(81)).segments).toBe(2);
  });

  it("a single non-GSM char forces UCS-2 (70/segment, 67 concatenated)", () => {
    const r = encodeAndSegment("hello 😀");
    expect(r.encoding).toBe("ucs2");
    // 😀 is beyond the BMP = a surrogate PAIR = 2 UTF-16 units; "hello 😀" = 8 units → 1 segment.
    expect(r.length).toBe(8);
    expect(r.segments).toBe(1);
    // UTF-16 code units (not code points): 71×😀 = 142 units → 3 segments (was mis-counted as 2
    // under the old code-point count = under-billing). See fix/e5-ucs2-utf16-units + parity gate.
    expect(encodeAndSegment("😀".repeat(71)).segments).toBe(3);
  });

  it("empty body still bills as 1 segment", () => {
    expect(encodeAndSegment("").segments).toBe(1);
  });
});

describe("rateSegments", () => {
  it("cost = segments × per-segment rate", () => {
    expect(rateSegments(3, "GHS")).toBe(9n); // 3 × 3 pesewas
    expect(rateSegments(2, "NGN")).toBe(800n);
  });
  it("rejects an unpriced currency (never silently charge 0)", () => {
    expect(() => rateSegments(1, "EUR")).toThrow(UnknownCurrencyError);
  });
});

describe("decideResolution — honest-billing (commit on billableStatuses[0], S4/S6 split)", () => {
  const billable = ["accepted"] as const;
  const exemptions = [
    "internal_error",
    "suspension",
    "fraud_block",
    "geo_block",
  ] as const;
  const base = {
    billableStatuses: billable,
    platformFaultExemptions: exemptions,
  };

  it("send → accepted (not yet billed) → COMMIT", () => {
    expect(
      decideResolution({
        ...base,
        newStatus: "accepted",
        reachedBillable: false,
      }),
    ).toBe("commit");
  });
  it("reject-at-submit platform fault → REFUND (never charge for our fault)", () => {
    expect(
      decideResolution({
        ...base,
        newStatus: "failed",
        reachedBillable: false,
        faultCause: "internal_error",
      }),
    ).toBe("refund");
  });
  it("terminal fail without ever billing → REFUND", () => {
    expect(
      decideResolution({
        ...base,
        newStatus: "failed",
        reachedBillable: false,
      }),
    ).toBe("refund");
  });
  it("still sending (no ack) → NONE (wait for DLR/sweeper)", () => {
    expect(
      decideResolution({
        ...base,
        newStatus: "sending",
        reachedBillable: false,
      }),
    ).toBe("none");
  });
  it("S4: expired AFTER commit (reachedBillable) → NONE (stays billed)", () => {
    expect(
      decideResolution({
        ...base,
        newStatus: "expired",
        reachedBillable: true,
      }),
    ).toBe("none");
  });
  it("S6: expired never-billable → REFUND", () => {
    expect(
      decideResolution({
        ...base,
        newStatus: "expired",
        reachedBillable: false,
      }),
    ).toBe("refund");
  });
  it("DLR delivered/undelivered after commit → NONE (already billed)", () => {
    expect(
      decideResolution({
        ...base,
        newStatus: "delivered",
        reachedBillable: true,
      }),
    ).toBe("none");
    expect(
      decideResolution({
        ...base,
        newStatus: "undelivered",
        reachedBillable: true,
      }),
    ).toBe("none");
  });
});
