"use client";

import { useState } from "react";

export interface CursorPaginationState {
  readonly pageIndex: number;
  readonly cursors: readonly (string | null)[];
}

export function initialCursorPaginationState(): CursorPaginationState {
  return { pageIndex: 0, cursors: [null] };
}

export function previousCursorPage(
  state: CursorPaginationState,
): CursorPaginationState {
  return { ...state, pageIndex: Math.max(0, state.pageIndex - 1) };
}

export function nextCursorPage(
  state: CursorPaginationState,
  cursor: string,
): CursorPaginationState {
  return {
    pageIndex: state.pageIndex + 1,
    cursors: [...state.cursors.slice(0, state.pageIndex + 1), cursor],
  };
}

export function useCursorPagination() {
  const [state, setState] = useState<CursorPaginationState>(
    initialCursorPaginationState,
  );

  return {
    pageIndex: state.pageIndex,
    cursor: state.cursors[state.pageIndex] ?? null,
    canPrevious: state.pageIndex > 0,
    previous() {
      setState(previousCursorPage);
    },
    next(nextCursor: string) {
      setState((current) => nextCursorPage(current, nextCursor));
    },
    reset() {
      setState(initialCursorPaginationState());
    },
  };
}
