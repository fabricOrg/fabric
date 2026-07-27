"use client";

import { useCallback, useState } from "react";

/**
 * STANDARD KEYSET-PAGINATION hook (client). Owns the accumulated rows + the opaque cursor for a
 * "Load more" table: the server renders the first page, this appends each older/next page fetched
 * from a BFF route. Shared across every control-plane table (audit, tenants, staff) so paging
 * behaves identically everywhere.
 *
 * `fetchPage(cursor)` returns the next page + its `next_cursor` (null when exhausted). `onError`
 * lets each app route failures through its own toast surface — the hook stays app-agnostic.
 *
 * The rows RE-SEED when the server sends a different first page. This used to seed once, so after a
 * mutation the table kept rendering pre-mutation rows: `router.refresh()` correctly re-ran the
 * Server Component and passed fresh data, but `useState` ignores a changed initial value, and a
 * removed staff member stayed on screen until a full reload.
 *
 * The state machine below is exported as PURE functions so it can be tested without a React
 * renderer — this workspace has no component-testing stack, and the behaviour there is where the
 * bugs live. Everything lives in this one file on purpose: apps consume `@app/ui` as raw TS source
 * (`"./hooks/*": "./src/hooks/*.ts"`), and NodeNext wants a `.js` extension on relative imports
 * that the apps' bundler then cannot resolve. One file sidesteps the conflict.
 */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
}

export interface CursorPageState<T> {
  /** The server-rendered first page this state was built from — identity is the change signal. */
  readonly seed: readonly T[];
  /** Everything to render: the seed plus any pages appended by "Load more". */
  readonly items: readonly T[];
  /** Opaque keyset cursor for the next page; null when exhausted. */
  readonly cursor: string | null;
}

export function seedState<T>(
  seed: readonly T[],
  cursor: string | null,
): CursorPageState<T> {
  return { seed, items: [...seed], cursor };
}

/** Accumulate a fetched page onto the end. */
export function appendPage<T>(
  state: CursorPageState<T>,
  page: CursorPage<T>,
): CursorPageState<T> {
  return {
    seed: state.seed,
    items: [...state.items, ...page.items],
    cursor: page.next_cursor,
  };
}

/**
 * Re-seed when the server sent a different first page — a mutation happened and `router.refresh()`
 * re-ran the Server Component. Accumulated "Load more" pages are DISCARDED on purpose: they were
 * read before the change and can contain rows that no longer exist (the removed staff member is
 * the case that surfaced this).
 *
 * Compares by REFERENCE, not deep equality: a Server Component produces a new array identity only
 * when it actually re-runs, which is exactly the signal we want, and deep-comparing every row on
 * every render would cost more than it saves.
 *
 * Returns the SAME object when nothing changed. The hook applies this during render, so a new
 * object every time would loop forever.
 */
export function reseedIfChanged<T>(
  state: CursorPageState<T>,
  seed: readonly T[],
  cursor: string | null,
): CursorPageState<T> {
  if (state.seed === seed) return state;
  return seedState(seed, cursor);
}

export function useCursorPage<T>(
  initialItems: readonly T[],
  initialCursor: string | null,
  fetchPage: (cursor: string) => Promise<CursorPage<T>>,
  onError?: (error: unknown) => void,
): {
  items: T[];
  hasMore: boolean;
  loading: boolean;
  loadMore: () => Promise<void>;
  /** Replace the accumulated set (e.g. after a mutation refetches the first page). */
  reset: (items: readonly T[], cursor: string | null) => void;
} {
  const [state, setState] = useState<CursorPageState<T>>(() =>
    seedState(initialItems, initialCursor),
  );
  const [loading, setLoading] = useState(false);

  // Adjust state during render when the seed prop changes (React's documented alternative to an
  // effect for this). reseedIfChanged returns the same object when nothing moved, so this cannot
  // loop; a Server Component only produces a new array identity when it actually re-runs.
  const reseeded = reseedIfChanged(state, initialItems, initialCursor);
  if (reseeded !== state) setState(reseeded);

  const loadMore = useCallback(async () => {
    if (reseeded.cursor === null || loading) return;
    setLoading(true);
    try {
      const page = await fetchPage(reseeded.cursor);
      // Re-read from the setter argument rather than closing over `reseeded`: a refresh may have
      // landed while this request was in flight, and appending to a superseded list would
      // resurrect the rows the refresh just removed.
      setState((current) => appendPage(current, page));
    } catch (error) {
      onError?.(error);
    } finally {
      setLoading(false);
    }
  }, [reseeded, loading, fetchPage, onError]);

  const reset = useCallback((next: readonly T[], nextCursor: string | null) => {
    setState(seedState(next, nextCursor));
  }, []);

  return {
    items: [...reseeded.items],
    hasMore: reseeded.cursor !== null,
    loading,
    loadMore,
    reset,
  };
}
