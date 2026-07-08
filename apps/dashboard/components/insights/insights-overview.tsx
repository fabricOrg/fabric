"use client";

import { parseApiError } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import { Card, CardContent, CardHeader } from "@app/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { StatCard } from "@app/ui/components/ui/stat-card";
import { BarChart3, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DeliveryErrorsCard } from "@/components/insights/delivery-errors-card";
import {
  getInsightsSummary,
  type InsightsSummary,
} from "@/lib/client/insights-api";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; summary: InsightsSummary };

const rateFmt = new Intl.NumberFormat("en", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const intFmt = new Intl.NumberFormat("en");
const segFmt = new Intl.NumberFormat("en", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <StatCard label={label} value={value}>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </StatCard>
  );
}

function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}

export function InsightsOverview() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const summary = await getInsightsSummary();
      setState({ status: "ready", summary });
    } catch (payload) {
      const err = parseApiError(payload);
      setState({
        status: "error",
        message: err.message,
        ...(err.requestId ? { requestId: err.requestId } : {}),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-6">
        <StatGrid>
          {["sent", "rate", "failed", "segments"].map((k) => (
            <Card key={k}>
              <CardHeader className="gap-2 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </StatGrid>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {["r1", "r2", "r3", "r4"].map((k) => (
              <Skeleton key={k} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Couldn&apos;t load insights</AlertTitle>
        <AlertDescription>
          <p>{state.message}</p>
          {state.requestId && (
            <p>
              Contact support with{" "}
              <code className="font-mono">{state.requestId}</code>.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void load()}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const { summary } = state;

  if (summary.totalSent === 0) {
    return (
      <Empty className="mx-auto max-w-2xl">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BarChart3 />
          </EmptyMedia>
          <EmptyTitle>No insights yet</EmptyTitle>
          <EmptyDescription>
            Once you start sending, delivery analytics and error breakdowns will
            appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const deliveryRate =
    summary.totalSent === 0 ? 0 : summary.delivered / summary.totalSent;

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <StatTile
          label="Total sent"
          value={intFmt.format(summary.totalSent)}
          hint="Messages accepted in this window."
        />
        <StatTile
          label="Delivery rate"
          value={rateFmt.format(deliveryRate)}
          hint={`${intFmt.format(summary.delivered)} delivered`}
        />
        <StatTile
          label="Failed"
          value={intFmt.format(summary.failed)}
          hint="Undelivered or rejected by the carrier."
        />
        <StatTile
          label="Avg segments"
          value={segFmt.format(summary.avgSegments)}
          hint="Billed segments per message."
        />
      </StatGrid>

      <DeliveryErrorsCard errors={summary.errors} />
    </div>
  );
}
