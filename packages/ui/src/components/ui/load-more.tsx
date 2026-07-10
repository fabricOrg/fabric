"use client";

import { Button } from "@app/ui/components/ui/button";

/**
 * Standard "Load more" control for a keyset-paginated table (pairs with useCursorPage). Renders
 * nothing when there's no next page, so a table can drop it in unconditionally.
 */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center">
      <Button
        variant="outline"
        size="sm"
        onClick={onLoadMore}
        disabled={loading}
      >
        {loading ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
