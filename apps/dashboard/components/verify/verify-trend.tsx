"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { ChartSkeleton } from "@app/ui/components/ui/chart-skeleton";
import dynamic from "next/dynamic";
import type { VerifyTrendPoint } from "@/lib/client/verify-api";

// Lazy — recharts is heavy; defer it (client-only) so it never blocks the page's first paint.
// A type-matched skeleton holds the layout until the plot loads.
const VerifyTrendPlot = dynamic(
  () => import("./verify-trend-plot").then((m) => m.VerifyTrendPlot),
  {
    ssr: false,
    loading: () => <ChartSkeleton variant="area" className="h-56" />,
  },
);

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`size-2.5 rounded-full ${cls}`} aria-hidden />
      {label}
    </span>
  );
}

/** Verification attempts vs successful verifications over time — the conversion trend. */
export function VerifyTrend({
  points,
}: {
  points: readonly VerifyTrendPoint[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>Verifications over time</CardTitle>
            <CardDescription>
              Attempts vs verified, last {points.length} days.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <LegendDot cls="bg-chart-1" label="Attempts" />
            <LegendDot cls="bg-chart-2" label="Verified" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <VerifyTrendPlot points={points} />
      </CardContent>
    </Card>
  );
}
