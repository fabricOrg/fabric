"use client";

import {
  DataTable,
  DataTableColumnHeader,
} from "@app/ui/components/ui/data-table";
import { Progress } from "@app/ui/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { formatDateTime } from "@app/ui/lib/datetime";
import type { ColumnDef } from "@tanstack/react-table";
import { SearchX } from "lucide-react";
import { useState } from "react";
import {
  CampaignDetailSheet,
  CampaignStatusBadge,
} from "@/components/campaigns/campaign-detail-sheet";
import type { Campaign, CampaignStatus } from "@/lib/client/campaigns-api";

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  completed: "Completed",
  failed: "Failed",
};

const STATUSES: readonly CampaignStatus[] = [
  "draft",
  "scheduled",
  "sending",
  "completed",
  "failed",
];

const numberFmt = new Intl.NumberFormat("en-US");

function formatWhen(campaign: Campaign): { label: string; hint: string } {
  const iso = campaign.scheduledAt ?? campaign.createdAt;
  const label = formatDateTime(iso);
  return {
    label,
    hint: campaign.scheduledAt ? "Scheduled" : "Created",
  };
}

const columns: ColumnDef<Campaign>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <CampaignStatusBadge status={row.original.status} />,
  },
  {
    id: "audience",
    accessorFn: (c) => c.audienceSize,
    header: ({ column }) => (
      <div className="flex justify-end">
        <DataTableColumnHeader column={column} title="Audience" />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right font-mono tabular-nums">
        {numberFmt.format(row.original.audienceSize)}
      </div>
    ),
  },
  {
    id: "delivered",
    header: "Delivered",
    cell: ({ row }) => {
      const c = row.original;
      const pct = c.sent > 0 ? Math.round((c.delivered / c.sent) * 100) : 0;
      return (
        <div className="flex min-w-[9rem] flex-col gap-1">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {numberFmt.format(c.delivered)} / {numberFmt.format(c.sent)}
          </span>
          <Progress value={pct} aria-label={`${pct}% delivered`} />
        </div>
      );
    },
  },
  {
    id: "failed",
    accessorFn: (c) => c.failed,
    header: ({ column }) => (
      <div className="flex justify-end">
        <DataTableColumnHeader column={column} title="Failed" />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right font-mono tabular-nums">
        {row.original.failed > 0 ? (
          <span className="text-destructive">
            {numberFmt.format(row.original.failed)}
          </span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </div>
    ),
  },
  {
    id: "when",
    accessorFn: (c) => c.scheduledAt ?? c.createdAt,
    header: ({ column }) => (
      <div className="flex justify-end">
        <DataTableColumnHeader column={column} title="When" />
      </div>
    ),
    cell: ({ row }) => {
      const when = formatWhen(row.original);
      return (
        <div className="text-right text-muted-foreground">
          <span className="block">{when.label}</span>
          <span className="block text-xs">{when.hint}</span>
        </div>
      );
    },
  },
];

export function CampaignTable({
  campaigns,
}: {
  campaigns: readonly Campaign[];
}) {
  const [status, setStatus] = useState<CampaignStatus | "all">("all");
  const [selected, setSelected] = useState<Campaign | null>(null);

  const filtered = campaigns.filter(
    (c) => status === "all" || c.status === status,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as CampaignStatus | "all")}
        >
          <SelectTrigger className="sm:w-48" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        ariaLabel="Campaigns"
        onRowClick={setSelected}
        rowLabel={(c) => `Open ${c.name}`}
        emptyState={{
          title: "No matching campaigns",
          description: "Choose another lifecycle status to see more campaigns.",
          icon: <SearchX />,
        }}
        className="rounded-lg border"
      />

      <CampaignDetailSheet
        campaign={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
