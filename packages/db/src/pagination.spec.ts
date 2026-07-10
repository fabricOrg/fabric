import { describe, expect, it } from "vitest";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  takePage,
} from "./pagination.js";

/**
 * Shared keyset-pagination primitives — unit spec. keysetWhere needs live drizzle columns and is
 * covered by the per-endpoint integration specs (audit walk-through etc.); these are the pure
 * pieces every list depends on.
 */

describe("clampLimit", () => {
  it("defaults, floors, and bounds to [1, max]", () => {
    expect(clampLimit(undefined)).toBe(100);
    expect(clampLimit(Number.NaN)).toBe(100);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(25.9)).toBe(25);
    expect(clampLimit(9999)).toBe(500);
    expect(clampLimit(50, 100, 200)).toBe(50);
  });
});

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a timestamp primary + uuid id", () => {
    const primary = "2026-07-09T20:01:33.123Z";
    const id = "89142c33-48ad-471f-8018-9e6b009f7b0e";
    const decoded = decodeCursor(encodeCursor(primary, id));
    expect(decoded).toEqual({ primary, id });
  });

  it("round-trips an email primary (splits on the FIRST space only)", () => {
    // Defensive: even a primary containing a space rebuilds intact (id split at the first space).
    const decoded = decodeCursor(encodeCursor("ops@fabric.dev", "uuid-1"));
    expect(decoded).toEqual({ primary: "ops@fabric.dev", id: "uuid-1" });
  });

  it("returns null for garbage / malformed cursors", () => {
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
    // base64url of a string with no separator.
    expect(
      decodeCursor(Buffer.from("nospace").toString("base64url")),
    ).toBeNull();
  });
});

describe("takePage", () => {
  const toCursor = (n: number) => `c${n}`;

  it("returns all rows + null cursor when the fetch did not overflow", () => {
    const { page, nextCursor } = takePage([1, 2, 3], 5, toCursor);
    expect(page).toEqual([1, 2, 3]);
    expect(nextCursor).toBeNull();
  });

  it("trims the extra row and emits the cursor of the last KEPT row", () => {
    // limit 2, fetched 3 (limit+1) → page is [1,2], cursor from row 2, row 3 dropped.
    const { page, nextCursor } = takePage([1, 2, 3], 2, toCursor);
    expect(page).toEqual([1, 2]);
    expect(nextCursor).toBe("c2");
  });
});
