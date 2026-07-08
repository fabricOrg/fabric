"use client";

import type { AuditEventDto } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { DataTable } from "@app/ui/components/ui/data-table";
import type { ColumnDef } from "@tanstack/react-table";

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

export function AuditTable({ events }: { events: readonly AuditEventDto[] }) {
  return (
    <DataTable
      columns={columns}
      data={events as AuditEventDto[]}
      ariaLabel="Audit log"
      empty="No activity recorded yet."
    />
  );
}
