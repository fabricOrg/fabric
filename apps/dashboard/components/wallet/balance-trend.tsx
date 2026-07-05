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

export interface BalancePoint {
  /** Short axis label, e.g. "Jul 4". */
  readonly label: string;
  /** Balance in major units (display only — money math stays in bigint minor units upstream). */
  readonly balance: number;
}

function money(currency: string, value: number): string {
  return `${currency} ${value.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function BalanceTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: readonly { value?: number | string }[];
  label?: string | number;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono font-medium tabular-nums">
        {money(currency, Number(value))}
      </div>
    </div>
  );
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
          <ChartContainer
            config={{ balance: { label: "Balance", color: "var(--chart-1)" } }}
            className="h-56"
          >
            <AreaChart
              data={points as BalancePoint[]}
              margin={{ left: 4, right: 12, top: 8, bottom: 0 }}
            >
              <defs>
                <linearGradient id="fill-balance" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-balance)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-balance)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis
                width={70}
                domain={["auto", "auto"]}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                tickFormatter={(v: number) => money(currency, v)}
              />
              <Tooltip
                cursor={{ strokeDasharray: "4 4" }}
                content={<BalanceTooltip currency={currency} />}
              />
              <Area
                dataKey="balance"
                type="monotone"
                stroke="var(--color-balance)"
                strokeWidth={2}
                fill="url(#fill-balance)"
                dot={{ r: 3, fill: "var(--color-balance)" }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
