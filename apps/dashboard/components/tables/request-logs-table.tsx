"use client";

import type { RequestLogSummary } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { DataTable } from "@app/ui/components/ui/data-table";
import {
  StatusBadge as SharedStatusBadge,
  type StatusTone,
} from "@app/ui/components/ui/status-badge";
import { formatDateTime } from "@app/ui/lib/datetime";
import type { ColumnDef } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { toastApiError } from "@/lib/error-toast";

function StatusBadge({ status }: { status: number }) {
  // The label IS the code, so no icon: three digits are already unambiguous without colour.
  const tone: StatusTone =
    status >= 500 ? "danger" : status >= 400 ? "warning" : "success";
  return (
    <SharedStatusBadge
      tone={tone}
      label={String(status)}
      className="tabular-nums"
    />
  );
}

function formatTime(value: string): string {
  return formatDateTime(value);
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
