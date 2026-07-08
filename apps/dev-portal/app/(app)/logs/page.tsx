"use client";

import type { ApiLogSummary } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { ScrollText, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LogsTable } from "@/components/tables/logs-table";
import { toastApiError } from "@/lib/error-toast";
import { listLogs, type Scenario } from "@/lib/mock-api";

function LogsInner() {
  const [rows, setRows] = useState<ApiLogSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorReqId, setErrorReqId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

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
        <LogsTable rows={rows} />
      )}
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
