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
import type { FlowSeriesPoint } from "@/lib/client/flows-api";

// Lazy — recharts is heavy; defer it (client-only) so it never blocks the page's first paint.
// A type-matched skeleton holds the layout until the plot loads.
const VolumeChartPlot = dynamic(
  () => import("./volume-chart-plot").then((m) => m.VolumeChartPlot),
  {
    ssr: false,
    loading: () => <ChartSkeleton variant="area" className="h-56" />,
  },
);

/** Daily collected volume — the throughput trend behind the reconciled transaction list. */
export function VolumeChart({
  series,
}: {
  series: readonly FlowSeriesPoint[];
}) {
  const data = series.map((p) => ({
    date: p.date,
    volume: Number(p.volumeMinor) / 100,
    count: p.count,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Volume over time</CardTitle>
        <CardDescription>
          Collected per day, last {data.length} days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VolumeChartPlot data={data} />
      </CardContent>
    </Card>
  );
}
