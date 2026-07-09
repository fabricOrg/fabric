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
 */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
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
  const [items, setItems] = useState<T[]>([...initialItems]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);

  const loadMore = useCallback(async () => {
    if (cursor === null || loading) return;
    setLoading(true);
    try {
      const page = await fetchPage(cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.next_cursor);
    } catch (error) {
      onError?.(error);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, fetchPage, onError]);

  const reset = useCallback((next: readonly T[], nextCursor: string | null) => {
    setItems([...next]);
    setCursor(nextCursor);
  }, []);

  return { items, hasMore: cursor !== null, loading, loadMore, reset };
}
