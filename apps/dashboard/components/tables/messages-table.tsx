"use client";

import type { MessageDetail, MessageSummary } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  DataTable,
  DataTableColumnHeader,
} from "@app/ui/components/ui/data-table";
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
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type MessageStatus, StatusBadge } from "@/components/status-badge";
import { getMessage } from "@/lib/client/dashboard-api";
import { countryOf } from "@/lib/dial-codes";
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

const ALL = "all" as const;

function failureGuidance(reason: string): {
  cause: string;
  action: string;
} {
  const code = reason.toLowerCase();
  if (
    code.includes("dnd") ||
    code.includes("opt") ||
    code.includes("consent")
  ) {
    return {
      cause: "The recipient is suppressed by consent or DND policy.",
      action:
        "Do not retry until the recipient's legal sendability is verified.",
    };
  }
  if (code.includes("sender") || code.includes("originator")) {
    return {
      cause: "The carrier rejected the sender identity.",
      action: "Use an approved sender ID before composing a new send.",
    };
  }
  if (code.includes("invalid") || code.includes("number")) {
    return {
      cause: "The destination number was rejected as invalid or unreachable.",
      action: "Confirm the number in E.164 format before sending again.",
    };
  }
  return {
    cause: "The provider did not complete delivery.",
    action:
      "Check the timeline and provider status before creating a new send.",
  };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const columns: ColumnDef<MessageSummary>[] = [
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
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "provider",
    header: "Provider",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.provider}</span>
    ),
  },
  {
    accessorKey: "segments",
    header: ({ column }) => (
      <div className="flex justify-end">
        <DataTableColumnHeader column={column} title="Segments" />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.segments}</div>
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
    accessorKey: "createdAt",
    header: ({ column }) => (
      <div className="flex justify-end">
        <DataTableColumnHeader column={column} title="Time" />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right text-muted-foreground">
        {formatTime(row.original.createdAt)}
      </div>
    ),
  },
];

export function MessagesTable({
  messages,
  initialMessageId,
  initialStatus,
}: {
  messages: readonly MessageSummary[];
  initialMessageId?: string;
  initialStatus?: MessageStatus;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<MessageStatus | typeof ALL>(
    initialStatus ?? ALL,
  );
  // Provider is this SMS-only surface's channel/route dimension; a true multi-channel filter
  // (WhatsApp, voice) lands when those channels ship. Country is derived from the recipient mask.
  const [provider, setProvider] = useState<string>(ALL);
  const [country, setCountry] = useState<string>(ALL);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const providers = useMemo(
    () => [...new Set(messages.map((m) => m.provider))].sort(),
    [messages],
  );
  const countries = useMemo(
    () => [...new Set(messages.map((m) => countryOf(m.to)))].sort(),
    [messages],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return messages.filter(
      (m) =>
        (status === ALL || m.status === status) &&
        (provider === ALL || m.provider === provider) &&
        (country === ALL || countryOf(m.to) === country) &&
        m.to.toLowerCase().includes(needle),
    );
  }, [messages, q, status, provider, country]);

  const open = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      setDetail(await getMessage(id));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (initialMessageId) void open(initialMessageId);
  }, [initialMessageId, open]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search recipient…"
          className="sm:max-w-xs"
          aria-label="Search recipient"
        />
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as MessageStatus | typeof ALL)}
        >
          <SelectTrigger className="sm:w-44" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="sm:w-44" aria-label="Filter by provider">
            <SelectValue placeholder="All providers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All providers</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={country} onValueChange={setCountry}>
          <SelectTrigger className="sm:w-44" aria-label="Filter by country">
            <SelectValue placeholder="All countries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All countries</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        ariaLabel="Message log"
        onRowClick={(m) => open(m.id)}
        rowLabel={(m) => `Open message to ${m.to}`}
        empty="No messages match this filter."
      />

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
                <div className="flex flex-col gap-2 rounded-lg bg-destructive/8 p-3">
                  <span className="text-xs font-medium text-destructive">
                    Failure reason
                  </span>
                  <p className="text-sm">{detail.failureReason}</p>
                  <p className="text-sm">
                    {failureGuidance(detail.failureReason).cause}{" "}
                    {failureGuidance(detail.failureReason).action}
                  </p>
                  <p className="text-xs font-medium text-destructive">
                    Automatic retry is disabled because the recipient shown here
                    is masked and retry safety cannot be established.
                  </p>
                  {detail.requestId && (
                    <p className="text-xs text-muted-foreground">
                      Contact support with{" "}
                      <code className="font-mono">{detail.requestId}</code>.
                    </p>
                  )}
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="mt-1 w-fit"
                  >
                    <Link href="/send">Compose a corrected send</Link>
                  </Button>
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
                          {formatTime(ev.at)}
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
