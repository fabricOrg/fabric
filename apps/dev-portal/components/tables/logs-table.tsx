"use client";

import type { ApiLogDetail, ApiLogSummary } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { DataTable } from "@app/ui/components/ui/data-table";
import { Separator } from "@app/ui/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@app/ui/components/ui/sheet";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toastApiError } from "@/lib/error-toast";
import { getLog } from "@/lib/mock-api";
import { formatTimestamp } from "@/lib/time";

function statusClass(code: number): string {
  if (code >= 500)
    return "bg-destructive/12 text-destructive border-transparent";
  if (code >= 400) return "bg-warning/15 text-warning border-transparent";
  return "bg-success/12 text-success border-transparent";
}

function LogBody({ label, body }: { label: string; body: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
        {body ?? "—"}
      </pre>
    </div>
  );
}

export function LogsTable({ rows }: { rows: readonly ApiLogSummary[] }) {
  const [detail, setDetail] = useState<ApiLogDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  function openDetail(id: string) {
    setDetail(null);
    setDetailOpen(true);
    getLog(id)
      .then(setDetail)
      .catch((envelope) => {
        toastApiError(envelope);
        setDetailOpen(false);
      });
  }

  const columns: ColumnDef<ApiLogSummary>[] = [
    {
      accessorKey: "method",
      header: "Method",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">
          {row.original.method}
        </Badge>
      ),
    },
    {
      accessorKey: "endpoint",
      header: "Endpoint",
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.endpoint}</span>
      ),
    },
    {
      accessorKey: "statusCode",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          className={`tabular-nums ${statusClass(row.original.statusCode)}`}
        >
          {row.original.statusCode}
        </Badge>
      ),
    },
    {
      accessorKey: "requestId",
      header: "Request ID",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.requestId}
        </span>
      ),
    },
    {
      accessorKey: "latencyMs",
      header: () => <div className="text-right">Latency</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-muted-foreground">
          {row.original.latencyMs} ms
        </div>
      ),
    },
    {
      accessorKey: "at",
      header: () => <div className="text-right">Time</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-muted-foreground">
          {formatTimestamp(row.original.at)}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => null,
      cell: ({ row }) => (
        <div className="text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openDetail(row.original.id)}
            aria-label={`Open request ${row.original.requestId}`}
          >
            Details
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={[...rows]}
        ariaLabel="API request log"
        empty="No requests to show."
        className="rounded-lg border"
      />

      <Sheet open={detailOpen} onOpenChange={(o) => !o && setDetailOpen(false)}>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="font-mono text-base">
              {detail ? `${detail.method} ${detail.endpoint}` : "Request"}
            </SheetTitle>
            <SheetDescription>
              {detail ? detail.requestId : "Loading…"}
            </SheetDescription>
          </SheetHeader>
          {detail === null ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-4 overflow-y-auto p-4 text-sm">
              <div className="flex items-center justify-between">
                <Badge
                  className={`tabular-nums ${statusClass(detail.statusCode)}`}
                >
                  {detail.statusCode}
                </Badge>
                <span className="tabular-nums text-muted-foreground">
                  {detail.latencyMs} ms · {formatTimestamp(detail.at)}
                </span>
              </div>
              <Separator />
              <LogBody label="Request" body={detail.requestBody} />
              <LogBody label="Response" body={detail.responseBody} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
