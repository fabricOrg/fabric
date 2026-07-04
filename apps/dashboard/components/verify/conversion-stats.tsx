"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { cn } from "@app/ui/lib/utils";
import type { ConversionStats as ConversionStatsData } from "@/lib/client/verify-api";

/** verified / sent, guarded against a zero funnel. */
function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * A meter track + fill. Fills use full-strength semantic tokens against a `bg-muted` track so the
 * non-text contrast clears WCAG 3:1 in both themes (never a faint tint that disappears in dark mode).
 */
function Meter({
  value,
  fill,
  label,
}: {
  value: number;
  fill: string;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full transition-all", fill)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function Stage({
  label,
  count,
  meterValue,
  fill,
  subtext,
}: {
  label: string;
  count: number;
  meterValue: number;
  fill: string;
  subtext: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-lg tabular-nums">
          {count.toLocaleString("en")}
        </span>
      </div>
      <Meter value={meterValue} fill={fill} label={`${label}: ${subtext}`} />
      <span className="text-xs text-muted-foreground">{subtext}</span>
    </div>
  );
}

export function ConversionStats({ stats }: { stats: ConversionStatsData }) {
  const { sent, delivered, verified } = stats;
  const conversion = pct(verified, sent);
  const deliveryRate = pct(delivered, sent);
  const verifyOfDelivered = pct(verified, delivered);

  return (
    <Card>
      <CardHeader>
        <CardDescription>Conversion · last 24h</CardDescription>
        <CardTitle className="flex items-baseline gap-2">
          <span className="font-mono text-4xl tabular-nums">
            {conversion.toFixed(1)}%
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            verified of sent
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-3">
          <Stage
            label="Sent"
            count={sent}
            meterValue={100}
            fill="bg-primary"
            subtext="100% dispatched"
          />
          <Stage
            label="Delivered"
            count={delivered}
            meterValue={deliveryRate}
            fill="bg-primary"
            subtext={`${deliveryRate.toFixed(1)}% of sent`}
          />
          <Stage
            label="Verified"
            count={verified}
            meterValue={pct(verified, sent)}
            fill="bg-success"
            subtext={`${verifyOfDelivered.toFixed(1)}% of delivered`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
