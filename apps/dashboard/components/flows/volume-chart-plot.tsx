"use client";

import { ChartContainer } from "@app/ui/components/ui/chart";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** One day of collected volume, already converted to major units for display. */
export interface VolumeDatum {
  readonly date: string;
  readonly volume: number;
  readonly count: number;
}

function ghs(major: number): string {
  return `GHS ${major.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function VolumeTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly { payload?: { volume?: number; count?: number } }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{label}</div>
      <div className="font-mono tabular-nums">{ghs(point?.volume ?? 0)}</div>
      <div className="text-muted-foreground">
        {point?.count ?? 0} transaction{point?.count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

/** The recharts plot for VolumeChart — lazy-loaded so recharts never blocks first paint. */
export function VolumeChartPlot({ data }: { data: readonly VolumeDatum[] }) {
  return (
    <ChartContainer
      config={{ volume: { label: "Volume", color: "var(--chart-3)" } }}
      className="h-56"
    >
      <AreaChart
        data={data as VolumeDatum[]}
        margin={{ left: 4, right: 12, top: 8, bottom: 0 }}
      >
        <defs>
          <linearGradient id="fill-volume" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-volume)"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="var(--color-volume)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
        />
        <YAxis
          width={56}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tickFormatter={(v: number) =>
            v >= 1000 ? `GHS ${(v / 1000).toFixed(0)}k` : `GHS ${v}`
          }
        />
        <Tooltip
          cursor={{ strokeDasharray: "4 4" }}
          content={<VolumeTooltip />}
        />
        <Area
          dataKey="volume"
          type="monotone"
          stroke="var(--color-volume)"
          strokeWidth={2}
          fill="url(#fill-volume)"
        />
      </AreaChart>
    </ChartContainer>
  );
}
