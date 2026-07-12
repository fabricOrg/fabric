"use client";

import type { ApiLogSummary } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import {
  ErrorState,
  TableEmptyState,
  TableLoadingState,
} from "@app/ui/components/ui/states";
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
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Logs</PageHeaderTitle>
          <PageHeaderDescription>
            Recent API requests. Open a row for the request and response — the
            request ID ties back to any error you saw.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      {loading ? (
        <TableLoadingState rows={5} />
      ) : errorReqId !== null || rows === null ? (
        <ErrorState
          title="Couldn't load logs"
          message={
            errorReqId
              ? `Please try again. Contact support with ${errorReqId}.`
              : "Please try again."
          }
          onRetry={() => setReload((x) => x + 1)}
        />
      ) : rows.length === 0 ? (
        <TableEmptyState
          title="No requests yet"
          description="Your API calls will show up here once you start sending."
        />
      ) : (
        <LogsTable rows={rows} />
      )}
    </PageContainer>
  );
}

export default function LogsPage() {
  return (
    <Suspense fallback={<div className="w-full">Loading…</div>}>
      <LogsInner />
    </Suspense>
  );
}
