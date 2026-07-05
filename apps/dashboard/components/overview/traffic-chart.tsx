"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { ChartContainer } from "@app/ui/components/ui/chart";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OverviewTrafficPoint } from "@/lib/client/overview-api";

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`size-2.5 rounded-full ${cls}`} aria-hidden />
      {label}
    </span>
  );
}

function TrafficTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly { dataKey?: string | number; value?: number | string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const get = (key: string) =>
    Number(payload.find((p) => p.dataKey === key)?.value ?? 0).toLocaleString(
      "en",
    );
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{label}</div>
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-1" /> Sent {get("sent")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-2" /> Delivered{" "}
          {get("delivered")}
        </span>
      </div>
    </div>
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
        <ChartContainer
          config={{
            sent: { label: "Sent", color: "var(--chart-1)" },
            delivered: { label: "Delivered", color: "var(--chart-2)" },
          }}
          className="h-64"
        >
          <AreaChart
            data={points as OverviewTrafficPoint[]}
            margin={{ left: 4, right: 12, top: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="fill-sent" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-sent)"
                  stopOpacity={0.25}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-sent)"
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient id="fill-delivered" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-delivered)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-delivered)"
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
              width={44}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
              }
            />
            <Tooltip
              cursor={{ strokeDasharray: "4 4" }}
              content={<TrafficTooltip />}
            />
            <Area
              dataKey="sent"
              type="monotone"
              stroke="var(--color-sent)"
              strokeWidth={2}
              fill="url(#fill-sent)"
            />
            <Area
              dataKey="delivered"
              type="monotone"
              stroke="var(--color-delivered)"
              strokeWidth={2}
              fill="url(#fill-delivered)"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
