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
import type { OverviewTrafficPoint } from "@/lib/client/overview-api";

// Lazy — recharts is heavy; defer it (client-only) so it never blocks the page's first paint.
// A type-matched skeleton holds the layout until the plot loads.
const TrafficChartPlot = dynamic(
  () => import("./traffic-chart-plot").then((m) => m.TrafficChartPlot),
  {
    ssr: false,
    loading: () => <ChartSkeleton variant="area" className="h-64" />,
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

/** Messages sent vs delivered over the recent window — the "traffic at a glance" the page promises. */
export function TrafficChart({
  points,
}: {
  points: readonly OverviewTrafficPoint[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>Messages over time</CardTitle>
            <CardDescription>
              Sent vs delivered, last {points.length} days.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <LegendDot cls="bg-chart-1" label="Sent" />
            <LegendDot cls="bg-chart-2" label="Delivered" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <TrafficChartPlot points={points} />
      </CardContent>
    </Card>
  );
}
