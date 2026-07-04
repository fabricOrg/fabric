"use client";

import { Progress } from "@app/ui/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { useState } from "react";
import type { Campaign, CampaignStatus } from "@/lib/client/campaigns-api";
import {
  CampaignDetailSheet,
  CampaignStatusBadge,
} from "./campaign-detail-sheet";

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
  const label = new Date(iso).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    label,
    hint: campaign.scheduledAt ? "Scheduled" : "Created",
  };
}

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

      {/* Semantic <section> keeps the wide table's scroll region keyboard-focusable (WCAG 2.1.1). */}
      <section className="overflow-x-auto" tabIndex={0} aria-label="Campaigns">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Audience</TableHead>
              <TableHead>Delivered</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => {
              const when = formatWhen(c);
              const pct =
                c.sent > 0 ? Math.round((c.delivered / c.sent) * 100) : 0;
              return (
                <TableRow
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="cursor-pointer"
                  aria-label={`Open ${c.name}`}
                >
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <CampaignStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {numberFmt.format(c.audienceSize)}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-[9rem] flex-col gap-1">
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {numberFmt.format(c.delivered)} /{" "}
                        {numberFmt.format(c.sent)}
                      </span>
                      <Progress value={pct} aria-label={`${pct}% delivered`} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {c.failed > 0 ? (
                      <span className="text-destructive">
                        {numberFmt.format(c.failed)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    <span className="block">{when.label}</span>
                    <span className="block text-xs">{when.hint}</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {filtered.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No campaigns match this filter.
          </p>
        )}
      </section>

      <CampaignDetailSheet
        campaign={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
