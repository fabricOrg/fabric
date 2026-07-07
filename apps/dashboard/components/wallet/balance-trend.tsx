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

// Lazy — recharts is heavy; defer it (client-only) so it never blocks the page's first paint.
// A type-matched skeleton holds the layout until the plot loads.
const BalanceTrendPlot = dynamic(
  () => import("./balance-trend-plot").then((m) => m.BalanceTrendPlot),
  {
    ssr: false,
    loading: () => <ChartSkeleton variant="area" className="h-56" />,
  },
);

export interface BalancePoint {
  /** Short axis label, e.g. "Jul 4". */
  readonly label: string;
  /** Balance in major units (display only — money math stays in bigint minor units upstream). */
  readonly balance: number;
}

/** Running wallet balance over time — the burn-rate view a prepaid wallet needs. */
export function BalanceTrend({
  points,
  currency,
}: {
  points: readonly BalancePoint[];
  currency: string;
}) {
  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Balance over time</CardTitle>
        <CardDescription>
          Running wallet balance across activity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {points.length < 2 ? (
          <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            Not enough history yet — top up or send to see the trend.
          </div>
        ) : (
          <BalanceTrendPlot points={points} currency={currency} />
        )}
      </CardContent>
    </Card>
  );
}
