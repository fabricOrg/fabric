"use client";

import type { ApiLogDetail, ApiLogSummary } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Separator } from "@app/ui/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@app/ui/components/ui/sheet";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { ScrollText, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toastApiError } from "@/lib/error-toast";
import { getLog, listLogs, type Scenario } from "@/lib/mock-api";
import { formatTimestamp } from "@/lib/time";

function statusClass(code: number): string {
  if (code >= 500)
    return "bg-destructive/12 text-destructive border-transparent";
  if (code >= 400) return "bg-warning/15 text-warning border-transparent";
  return "bg-success/12 text-success border-transparent";
}

function LogsInner() {
  const [rows, setRows] = useState<ApiLogSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorReqId, setErrorReqId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [detail, setDetail] = useState<ApiLogDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const stateParam = useSearchParams().get("state");
  const scenario: Scenario =
    stateParam === "empty" || stateParam === "error" ? stateParam : "populated";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` is a manual refetch trigger, not read in the effect
  useEffect(() => {
    let live = true;
    setLoading(true);
    setErrorReqId(null);
    listLogs(scenario)
      .then((data) => {
        if (live) setRows([...data]);
      })
      .catch((envelope) => {
        if (!live) return;
        setErrorReqId(toastApiError(envelope).requestId ?? null);
        setRows(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [reload, scenario]);

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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Logs
        </h1>
        <p className="text-sm text-muted-foreground">
          Recent API requests. Open a row for the request and response — the
          request ID ties back to any error you saw.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : errorReqId !== null || rows === null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Couldn't load logs</EmptyTitle>
            <EmptyDescription>
              Please try again.{" "}
              {errorReqId ? `Contact support with ${errorReqId}.` : ""}
            </EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" onClick={() => setReload((x) => x + 1)}>
            Retry
          </Button>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText />
            </EmptyMedia>
            <EmptyTitle>No requests yet</EmptyTitle>
            <EmptyDescription>
              Your API calls will show up here once you start sending.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Method</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Request ID</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {r.method}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {r.endpoint}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`tabular-nums ${statusClass(r.statusCode)}`}
                    >
                      {r.statusCode}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.requestId}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.latencyMs} ms
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatTimestamp(r.at)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDetail(r.id)}
                      aria-label={`Open request ${r.requestId}`}
                    >
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
    </div>
  );
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

export default function LogsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl p-6">Loading…</div>}>
      <LogsInner />
    </Suspense>
  );
}
