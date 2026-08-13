"use client";

import type { WhatsappMessage } from "@app/contracts";
import {
  DataTable,
  DataTableColumnHeader,
} from "@app/ui/components/ui/data-table";
import { formatDateTime } from "@app/ui/lib/datetime";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney } from "@/lib/money";

const columns: ColumnDef<WhatsappMessage>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "template_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Template" />
    ),
    cell: ({ row }) => (
      <div className="flex min-w-44 flex-col gap-1">
        <span className="font-medium">
          {row.original.template_name ?? "Unknown template"}
        </span>
        <span className="text-muted-foreground text-xs">
          {row.original.template_language ?? "unknown language"} -{" "}
          {row.original.template_category ?? "unknown category"}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "to",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Recipient" />
    ),
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.to}</span>
    ),
  },
  {
    id: "cost",
    header: () => <div className="text-right">Cost</div>,
    cell: ({ row }) => (
      <div className="text-right font-mono tabular-nums">
        {formatMoney(row.original.cost)}
      </div>
    ),
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => (
      <div className="flex justify-end">
        <DataTableColumnHeader column={column} title="Created" />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right text-muted-foreground">
        {formatDateTime(row.original.created_at)}
      </div>
    ),
  },
];

export function WhatsappMessagesTable({
  messages,
}: {
  messages: readonly WhatsappMessage[];
}) {
  return (
    <DataTable
      columns={columns}
      data={[...messages]}
      pageSize={20}
      ariaLabel="WhatsApp messages"
      empty="No WhatsApp messages match this view."
    />
  );
}
