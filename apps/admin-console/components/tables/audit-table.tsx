"use client";

import type { AuditEventDto, ListAuditResponse } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { DataTable } from "@app/ui/components/ui/data-table";
import { LoadMore } from "@app/ui/components/ui/load-more";
import { useCursorPage } from "@app/ui/hooks/use-cursor-page";
import type { ColumnDef } from "@tanstack/react-table";
import { toastApiError } from "@/lib/error-toast";

/** Fetch the next audit page from the staff BFF route (keyset cursor). */
async function fetchAuditPage(cursor: string): Promise<ListAuditResponse> {
  const response = await fetch(
    `/api/admin/audit?cursor=${encodeURIComponent(cursor)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload as ListAuditResponse;
}

function formatTime(iso: string): string {
  // Stable UTC render (avoids SSR/client locale drift): "2026-07-07 02:31".
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function target(event: AuditEventDto): string {
  if (!event.target_type) return "—";
  return event.target_id
    ? `${event.target_type}:${event.target_id}`
    : event.target_type;
}

const columns: ColumnDef<AuditEventDto>[] = [
  {
    id: "actor",
    header: "Actor",
    cell: ({ row }) => (
      <span className="font-mono text-sm">
        {row.original.actor_email ?? "system"}
      </span>
    ),
  },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => (
      <Badge variant="secondary" className="font-mono text-xs">
        {row.original.action}
      </Badge>
    ),
  },
  {
    id: "target",
    header: "Target",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {target(row.original)}
      </span>
    ),
  },
  {
    id: "summary",
    header: "Summary",
    cell: ({ row }) => (
      <span className="block max-w-xs text-sm">{row.original.summary}</span>
    ),
  },
  {
    id: "reason",
    header: "Reason",
    cell: ({ row }) => (
      <span className="block max-w-xs text-sm text-muted-foreground">
        {row.original.reason ?? "—"}
      </span>
    ),
  },
  {
    id: "time",
    header: () => <div className="text-right">Time</div>,
    cell: ({ row }) => (
      <div className="text-right font-mono text-xs text-muted-foreground tabular-nums">
        {formatTime(row.original.created_at)}
      </div>
    ),
  },
];

export function AuditTable({
  events,
  nextCursor,
}: {
  events: readonly AuditEventDto[];
  nextCursor: string | null;
}) {
  // First page server-rendered; the shared keyset hook appends older pages via the BFF route.
  const { items, hasMore, loading, loadMore } = useCursorPage(
    events,
    nextCursor,
    async (cursor) => {
      const page = await fetchAuditPage(cursor);
      return { items: page.events, next_cursor: page.next_cursor };
    },
    toastApiError,
  );

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        columns={columns}
        data={items}
        ariaLabel="Audit log"
        empty="No activity recorded yet."
      />
      <LoadMore hasMore={hasMore} loading={loading} onLoadMore={loadMore} />
    </div>
  );
}
