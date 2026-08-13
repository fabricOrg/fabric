import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  parsePageQuery,
  parseUuidPageQuery,
} from "./cursor.js";

const TS = "2026-07-24T10:00:00.600789Z";

// invalidRequest throws a Nest HttpException whose stable code lives in the response body.
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("keyset cursor codec", () => {
  it("round-trips a microsecond-precise timestamp and id", () => {
    const cursor = { createdAt: TS, id: "msg_01HZX4" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("keeps an id containing the separator character intact", () => {
    const cursor = { createdAt: TS, id: "weird|id|with|pipes" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("fails closed on garbage, hand-built, and ms-precision cursors", () => {
    const cases = [
      "not-base64url-!!!",
      Buffer.from("no-separator", "utf8").toString("base64url"),
      Buffer.from("2026-07-24T10:00:00.600Z|msg_1", "utf8").toString(
        "base64url",
      ), // ms precision — not a token we ever minted
      Buffer.from(`${TS}|`, "utf8").toString("base64url"), // empty id
    ];
    for (const value of cases) {
      expect(thrownBy(() => decodeCursor(value))).toMatchObject({
        response: { error: { code: "invalid_cursor" } },
      });
    }
  });
});

describe("parsePageQuery", () => {
  it("defaults the limit and ignores unrelated query params", () => {
    expect(parsePageQuery({ state: "dead" })).toEqual({ limit: 50 });
  });

  it("coerces a numeric limit and decodes a valid cursor", () => {
    const token = encodeCursor({ createdAt: TS, id: "msg_1" });
    expect(parsePageQuery({ limit: "25", cursor: token })).toEqual({
      limit: 25,
      before: { createdAt: TS, id: "msg_1" },
    });
  });

  it("rejects an out-of-range or non-numeric limit", () => {
    for (const limit of ["0", "101", "abc", "1.5"]) {
      expect(thrownBy(() => parsePageQuery({ limit }))).toMatchObject({
        response: { error: { code: "invalid_page" } },
      });
    }
  });

  it("rejects an oversized cursor before decoding it", () => {
    expect(
      thrownBy(() => parsePageQuery({ cursor: "x".repeat(513) })),
    ).toMatchObject({ response: { error: { code: "invalid_cursor" } } });
  });

  it("rejects a valid cursor envelope with a non-UUID row id", () => {
    const token = encodeCursor({ createdAt: TS, id: "not-a-uuid" });
    expect(thrownBy(() => parseUuidPageQuery({ cursor: token }))).toMatchObject(
      { response: { error: { code: "invalid_cursor" } } },
    );
  });
});
