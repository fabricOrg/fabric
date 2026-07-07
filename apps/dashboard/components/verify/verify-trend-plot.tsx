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
import type { VerifyTrendPoint } from "@/lib/client/verify-api";

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly { payload?: { attempts?: number; verified?: number } }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  const attempts = p?.attempts ?? 0;
  const verified = p?.verified ?? 0;
  const rate = attempts > 0 ? ((verified / attempts) * 100).toFixed(1) : "0.0";
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{label}</div>
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-1" /> Attempts{" "}
          {attempts.toLocaleString("en")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-2" /> Verified{" "}
          {verified.toLocaleString("en")}
        </span>
        <span className="text-muted-foreground">{rate}% conversion</span>
      </div>
    </div>
  );
}

/** The recharts plot for VerifyTrend — lazy-loaded so recharts never blocks first paint. */
export function VerifyTrendPlot({
  points,
}: {
  points: readonly VerifyTrendPoint[];
}) {
  return (
    <ChartContainer
      config={{
        attempts: { label: "Attempts", color: "var(--chart-1)" },
        verified: { label: "Verified", color: "var(--chart-2)" },
      }}
      className="h-56"
    >
      <AreaChart
        data={points as VerifyTrendPoint[]}
        margin={{ left: 4, right: 12, top: 8, bottom: 0 }}
      >
        <defs>
          <linearGradient id="fill-attempts" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-attempts)"
              stopOpacity={0.25}
            />
            <stop
              offset="95%"
              stopColor="var(--color-attempts)"
              stopOpacity={0}
            />
          </linearGradient>
          <linearGradient id="fill-verified" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-verified)"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="var(--color-verified)"
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
        <YAxis width={36} tickLine={false} axisLine={false} tickMargin={4} />
        <Tooltip
          cursor={{ strokeDasharray: "4 4" }}
          content={<TrendTooltip />}
        />
        <Area
          dataKey="attempts"
          type="monotone"
          stroke="var(--color-attempts)"
          strokeWidth={2}
          fill="url(#fill-attempts)"
        />
        <Area
          dataKey="verified"
          type="monotone"
          stroke="var(--color-verified)"
          strokeWidth={2}
          fill="url(#fill-verified)"
        />
      </AreaChart>
    </ChartContainer>
  );
}
