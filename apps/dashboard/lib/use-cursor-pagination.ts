"use client";

import { useState } from "react";

export function useCursorPagination() {
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);

  return {
    pageIndex,
    cursor: cursors[pageIndex] ?? null,
    canPrevious: pageIndex > 0,
    previous() {
      setPageIndex((current) => Math.max(0, current - 1));
    },
    next(nextCursor: string) {
      setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
      setPageIndex((current) => current + 1);
    },
  };
}
