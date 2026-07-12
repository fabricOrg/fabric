"use client";

import type { RequestLogSummary } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { DataTable } from "@app/ui/components/ui/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { toastApiError } from "@/lib/error-toast";

function StatusBadge({ status }: { status: number }) {
  const cls =
    status >= 500
      ? "bg-destructive/12 text-destructive"
      : status >= 400
        ? "bg-warning/15 text-warning-strong"
        : "bg-success/12 text-success";
  return (
    <Badge
      variant="outline"
      className={`border-transparent ${cls} tabular-nums`}
    >
      {status}
    </Badge>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const columns: ColumnDef<RequestLogSummary>[] = [
  {
    id: "request",
    header: "Request",
    cell: ({ row }) => (
      <span className="font-mono text-sm">
        <span className="text-muted-foreground">{row.original.method}</span>{" "}
        {row.original.path}
      </span>
    ),
  },
  {
    accessorKey: "status_code",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status_code} />,
  },
  {
    accessorKey: "latency_ms",
    header: () => <div className="text-right">Latency</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {row.original.latency_ms}ms
      </div>
    ),
  },
  {
    accessorKey: "request_id",
    header: "Request ID",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.request_id}
      </span>
    ),
  },
  {
    accessorKey: "created_at",
    header: () => <div className="text-right">Time</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {formatTime(row.original.created_at)}
      </div>
    ),
  },
];

export function RequestLogsTable({
  initialLogs,
  initialCursor,
  applicationId,
  env,
}: {
  initialLogs: readonly RequestLogSummary[];
  initialCursor: string | null;
  applicationId: string;
  env: "sandbox" | "live";
}) {
  const [logs, setLogs] = useState<RequestLogSummary[]>([...initialLogs]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ applicationId, env, cursor });
      const response = await fetch(`/api/logs?${params.toString()}`);
      if (!response.ok) {
        toastApiError(await response.json().catch(() => null));
        return;
      }
      const page = (await response.json()) as {
        logs: RequestLogSummary[];
        next_cursor: string | null;
      };
      setLogs((prev) => [...prev, ...page.logs]);
      setCursor(page.next_cursor);
    } catch {
      toastApiError(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        columns={columns}
        data={logs}
        ariaLabel="Request logs"
        emptyState={{
          icon: <ScrollText />,
          title: "No requests yet",
          description:
            "Requests made with this environment's API keys will appear here.",
        }}
      />
      {cursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            loading={loading}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
