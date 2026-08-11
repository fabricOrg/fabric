"use client";

import {
  DataTable,
  DataTableColumnHeader,
} from "@app/ui/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import {
  StatusBadge as SharedStatusBadge,
  type StatusTone,
} from "@app/ui/components/ui/status-badge";
import { formatDate } from "@app/ui/lib/datetime";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeCheck, CircleX, Clock, type LucideIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type {
  SenderCountry,
  SenderId,
  SenderStatus,
} from "@/lib/client/senders-api";
import { SENDER_COUNTRIES, SENDER_STATUSES } from "@/lib/client/senders-api";

const COUNTRY_LABEL: Record<SenderCountry, string> = {
  NG: "Nigeria",
  GH: "Ghana",
};

const TYPE_LABEL: Record<SenderId["type"], string> = {
  alphanumeric: "Alphanumeric",
  "short-code": "Short code",
};

// Colour is never the only signal (WCAG 1.4.1): each state pairs a tone with an icon and a label.
const STATUS_META: Record<
  SenderStatus,
  { label: string; icon: LucideIcon; tone: StatusTone }
> = {
  active: { label: "Active", icon: BadgeCheck, tone: "success" },
  pending: { label: "Pending review", icon: Clock, tone: "warning" },
  rejected: { label: "Rejected", icon: CircleX, tone: "danger" },
};

function StatusBadge({ status }: { status: SenderStatus }) {
  const { label, icon, tone } = STATUS_META[status];
  return <SharedStatusBadge tone={tone} label={label} icon={icon} />;
}

function formatSubmitted(iso: string): string {
  return formatDate(iso);
}

const baseColumns: ColumnDef<SenderId>[] = [
  {
    accessorKey: "senderId",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Sender ID" />
    ),
    cell: ({ row }) => (
      <span className="font-mono font-medium">{row.original.senderId}</span>
    ),
  },
  {
    id: "country",
    accessorFn: (s) => COUNTRY_LABEL[s.country],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Country" />
    ),
    cell: ({ row }) => COUNTRY_LABEL[row.original.country],
  },
  {
    id: "type",
    accessorFn: (s) => TYPE_LABEL[s.type],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {TYPE_LABEL[row.original.type]}
      </span>
    ),
  },
  {
    id: "useCase",
    header: "Use case",
    cell: ({ row }) => (
      <span className="block max-w-xs text-muted-foreground">
        {row.original.useCase}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => {
      const s = row.original;
      return (
        <div className="flex max-w-xs flex-col items-start gap-1">
          <StatusBadge status={s.status} />
          {s.status === "rejected" && s.note ? (
            <span className="text-xs text-destructive">{s.note}</span>
          ) : null}
        </div>
      );
    },
  },
  {
    accessorKey: "submittedAt",
    header: ({ column }) => (
      <div className="flex justify-end">
        <DataTableColumnHeader column={column} title="Submitted" />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {formatSubmitted(row.original.submittedAt)}
      </div>
    ),
  },
];

export function SenderIdTable({
  senders,
  initialStatus,
  rowAction,
}: {
  senders: readonly SenderId[];
  initialStatus?: SenderStatus;
  /** Rendered against a rejected row, so the fix sits beside the reason instead of in a second card. */
  rowAction?: (sender: SenderId) => ReactNode;
}) {
  const [status, setStatus] = useState<SenderStatus | "all">(
    initialStatus ?? "all",
  );
  const [country, setCountry] = useState<SenderCountry | "all">("all");

  const columns = useMemo<ColumnDef<SenderId>[]>(
    () =>
      rowAction
        ? [
            ...baseColumns,
            {
              id: "actions",
              header: "",
              cell: ({ row }) =>
                row.original.status === "rejected" ? (
                  <div className="flex justify-end">
                    {rowAction(row.original)}
                  </div>
                ) : null,
            },
          ]
        : baseColumns,
    [rowAction],
  );

  const filtered = useMemo(
    () =>
      senders.filter(
        (s) =>
          (status === "all" || s.status === status) &&
          (country === "all" || s.country === country),
      ),
    [senders, status, country],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as SenderStatus | "all")}
        >
          <SelectTrigger className="sm:w-48" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SENDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={country}
          onValueChange={(v) => setCountry(v as SenderCountry | "all")}
        >
          <SelectTrigger className="sm:w-48" aria-label="Filter by country">
            <SelectValue placeholder="All countries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All countries</SelectItem>
            {SENDER_COUNTRIES.map((c) => (
              <SelectItem key={c} value={c}>
                {COUNTRY_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        ariaLabel="Sender IDs"
        empty="No sender IDs match this filter."
      />
    </div>
  );
}
