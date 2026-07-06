import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Progress } from "@app/ui/components/ui/progress";
import type {
  OverviewChannel,
  OverviewChannelSpend,
} from "@/lib/client/overview-api";
import { formatMoney } from "@/lib/money";

/**
 * Channel presentation. Bars use the brand-agnostic categorical chart tokens (--chart-1..4), which are
 * solid fills tuned for WCAG 3:1 non-text contrast against the card in BOTH light and dark themes.
 * The `bar` class overrides the Progress indicator via its data-slot so each channel reads distinctly.
 */
const CHANNEL: Record<
  OverviewChannel,
  { label: string; dot: string; bar: string }
> = {
  sms: {
    label: "SMS",
    dot: "bg-chart-1",
    bar: "[&>[data-slot=progress-indicator]]:bg-chart-1",
  },
  whatsapp: {
    label: "WhatsApp",
    dot: "bg-chart-2",
    bar: "[&>[data-slot=progress-indicator]]:bg-chart-2",
  },
  voice: {
    label: "Voice",
    dot: "bg-chart-3",
    bar: "[&>[data-slot=progress-indicator]]:bg-chart-3",
  },
  verify: {
    label: "Verify",
    dot: "bg-chart-4",
    bar: "[&>[data-slot=progress-indicator]]:bg-chart-4",
  },
};

/** Exact-bigint proportion → a 2-dp percentage for the bar width (not money; safe to be a Number). */
function proportionPct(spendMinor: bigint, totalMinor: bigint): number {
  if (totalMinor <= 0n) return 0;
  return Number((spendMinor * 10000n) / totalMinor) / 100;
}

export function SpendByChannel({
  channels,
}: {
  channels: readonly OverviewChannelSpend[];
}) {
  // Total via exact bigint minor-unit sum — never float. Drives each bar's proportion.
  const totalMinor = channels.reduce(
    (sum, c) => sum + BigInt(c.spend.minor),
    0n,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend by channel</CardTitle>
        <CardDescription>Where your budget went this month.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {channels.map((c) => {
          const meta = CHANNEL[c.channel];
          const pct = proportionPct(BigInt(c.spend.minor), totalMinor);
          return (
            <div key={c.channel} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className={`size-2.5 shrink-0 rounded-full ${meta.dot}`}
                    aria-hidden
                  />
                  {meta.label}
                </span>
                <span className="font-mono text-sm tabular-nums">
                  {formatMoney(c.spend)}
                </span>
              </div>
              <Progress
                value={pct}
                aria-label={`${meta.label} ${pct.toFixed(1)} percent of channel spend`}
                className={meta.bar}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
