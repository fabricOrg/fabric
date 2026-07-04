"use client";

import type { MessageDetail, MessageSummary } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@app/ui/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { useState } from "react";
import { type MessageStatus, StatusBadge } from "@/components/status-badge";
import { getMessage } from "@/lib/client/dashboard-api";
import { formatMoney } from "@/lib/money";

const STATUSES: readonly MessageStatus[] = [
  "queued",
  "sending",
  "accepted",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "expired",
];

export function MessagesTable({
  messages,
}: {
  messages: readonly MessageSummary[];
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<MessageStatus | "all">("all");
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const filtered = messages.filter(
    (m) =>
      (status === "all" || m.status === status) &&
      m.to.toLowerCase().includes(q.trim().toLowerCase()),
  );

  async function open(id: string) {
    setLoadingDetail(true);
    try {
      setDetail(await getMessage(id));
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search recipient…"
          className="sm:max-w-xs"
          aria-label="Search recipient"
        />
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as MessageStatus | "all")}
        >
          <SelectTrigger className="sm:w-44" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Semantic <section> keeps the wide table's scroll region keyboard-focusable (WCAG 2.1.1). */}
      <section
        className="overflow-x-auto"
        tabIndex={0}
        aria-label="Message log"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Segments</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => (
              <TableRow
                key={m.id}
                onClick={() => open(m.id)}
                className="cursor-pointer"
              >
                <TableCell className="font-mono text-sm">{m.to}</TableCell>
                <TableCell>
                  <StatusBadge status={m.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {m.provider}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.segments}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatMoney(m.cost)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {new Date(m.createdAt).toLocaleString("en", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No messages match this filter.
          </p>
        )}
      </section>

      <Sheet
        open={detail !== null || loadingDetail}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="font-mono text-base">
              {detail?.id ?? "Loading…"}
            </SheetTitle>
            <SheetDescription>
              {detail
                ? `${detail.to} · ${detail.provider}`
                : "Fetching message…"}
            </SheetDescription>
          </SheetHeader>

          {detail && (
            <div className="flex flex-col gap-6 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={detail.status} />
                <Badge variant="secondary">
                  {detail.segments} seg · {formatMoney(detail.cost)}
                </Badge>
                <Badge variant="outline">
                  {detail.encoding === "ucs2" ? "UCS-2" : "GSM-7"}
                </Badge>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Message
                </span>
                <p className="text-sm">
                  {detail.redacted ? (
                    <span className="text-muted-foreground italic">
                      Redacted (OTP body)
                    </span>
                  ) : (
                    (detail.body ?? "—")
                  )}
                </p>
              </div>

              {detail.failureReason && (
                <div className="flex flex-col gap-1 rounded-lg bg-destructive/8 p-3">
                  <span className="text-xs font-medium text-destructive">
                    Failure reason
                  </span>
                  <p className="text-sm">{detail.failureReason}</p>
                  {detail.requestId && (
                    <p className="text-xs text-muted-foreground">
                      Contact support with{" "}
                      <code className="font-mono">{detail.requestId}</code>.
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  Delivery timeline
                </span>
                <ol className="flex flex-col gap-3">
                  {detail.timeline.map((ev, i) => (
                    <li key={`${ev.status}-${ev.at}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className="size-2 rounded-full bg-primary" />
                        {i < detail.timeline.length - 1 && (
                          <span className="w-px flex-1 bg-border" />
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 pb-1">
                        <StatusBadge status={ev.status} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(ev.at).toLocaleString("en", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {ev.note ? ` · ${ev.note}` : ""}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
