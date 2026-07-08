"use client";

import { Badge } from "@app/ui/components/ui/badge";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@app/ui/components/ui/tooltip";
import { cn } from "@app/ui/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeCheck, CircleX, Clock, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
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

// Colour is never the only signal (WCAG 1.4.1): each state pairs a semantic token with an icon.
const STATUS_META: Record<
  SenderStatus,
  { label: string; icon: LucideIcon; cls: string }
> = {
  active: {
    label: "Active",
    icon: BadgeCheck,
    cls: "bg-success/12 text-success",
  },
  pending: {
    label: "Pending review",
    icon: Clock,
    cls: "bg-warning/15 text-warning-strong",
  },
  rejected: {
    label: "Rejected",
    icon: CircleX,
    cls: "bg-destructive/12 text-destructive",
  },
};

function StatusBadge({ status }: { status: SenderStatus }) {
  const { label, icon: Icon, cls } = STATUS_META[status];
  return (
    <Badge variant="outline" className={cn("gap-1 border-transparent", cls)}>
      <Icon />
      {label}
    </Badge>
  );
}

function formatSubmitted(iso: string): string {
  return new Date(iso).toLocaleDateString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const columns: ColumnDef<SenderId>[] = [
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
      return s.status === "rejected" && s.note ? (
        <Tooltip>
          <TooltipTrigger className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <StatusBadge status={s.status} />
            <span className="sr-only">Rejection reason: {s.note}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{s.note}</TooltipContent>
        </Tooltip>
      ) : (
        <StatusBadge status={s.status} />
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

export function SenderIdTable({ senders }: { senders: readonly SenderId[] }) {
  const [status, setStatus] = useState<SenderStatus | "all">("all");
  const [country, setCountry] = useState<SenderCountry | "all">("all");

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
    <TooltipProvider>
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

        {filtered.some((s) => s.status === "rejected") && (
          <p className="text-xs text-muted-foreground">
            Rejected sender IDs show the reason on hover or focus. Resubmit with
            a corrected request.
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}
