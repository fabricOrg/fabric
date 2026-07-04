"use client";

import { Badge } from "@app/ui/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@app/ui/components/ui/tooltip";
import { cn } from "@app/ui/lib/utils";
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

        {/* Semantic <section> keeps the wide table's scroll region keyboard-focusable (WCAG 2.1.1). */}
        <section
          className="overflow-x-auto"
          tabIndex={0}
          aria-label="Sender IDs"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sender ID</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Use case</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono font-medium">
                    {s.senderId}
                  </TableCell>
                  <TableCell>{COUNTRY_LABEL[s.country]}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {TYPE_LABEL[s.type]}
                  </TableCell>
                  <TableCell className="max-w-xs text-muted-foreground">
                    {s.useCase}
                  </TableCell>
                  <TableCell>
                    {s.status === "rejected" && s.note ? (
                      <Tooltip>
                        <TooltipTrigger className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                          <StatusBadge status={s.status} />
                          <span className="sr-only">
                            Rejection reason: {s.note}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {s.note}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <StatusBadge status={s.status} />
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatSubmitted(s.submittedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No sender IDs match this filter.
            </p>
          )}
        </section>

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
