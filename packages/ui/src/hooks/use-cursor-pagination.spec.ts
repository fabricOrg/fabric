import { describe, expect, it } from "vitest";
import {
  initialCursorPaginationState,
  nextCursorPage,
  previousCursorPage,
} from "./use-cursor-pagination.js";

describe("cursor pagination state", () => {
  it("walks forward and back through opaque cursors", () => {
    const first = initialCursorPaginationState();
    const second = nextCursorPage(first, "cursor-2");
    const third = nextCursorPage(second, "cursor-3");

    expect(third).toEqual({
      pageIndex: 2,
      cursors: [null, "cursor-2", "cursor-3"],
    });
    expect(previousCursorPage(third)).toEqual({
      pageIndex: 1,
      cursors: [null, "cursor-2", "cursor-3"],
    });
  });

  it("replaces forward history after going back", () => {
    const state = {
      pageIndex: 1,
      cursors: [null, "cursor-2", "stale-cursor"],
    };
    expect(nextCursorPage(state, "fresh-cursor")).toEqual({
      pageIndex: 2,
      cursors: [null, "cursor-2", "fresh-cursor"],
    });
  });

  it("does not move before the first page", () => {
    expect(previousCursorPage(initialCursorPaginationState()).pageIndex).toBe(
      0,
    );
  });
});
