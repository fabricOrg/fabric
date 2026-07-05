import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Progress } from "@app/ui/components/ui/progress";
import { cn } from "@app/ui/lib/utils";
import {
  ArrowUpRight,
  CheckCheck,
  type LucideIcon,
  MessageSquare,
  Receipt,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { OverviewSummary } from "@/lib/client/overview-api";
import { formatMoney } from "@/lib/money";

/** Icon chip — a solid-token tint that clears WCAG 3:1 non-text contrast in both themes. */
function StatIcon({ icon: Icon, cls }: { icon: LucideIcon; cls: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
        cls,
      )}
    >
      <Icon aria-hidden />
    </span>
  );
}

/**
 * The at-a-glance row: messages sent, delivery rate, spend this month, wallet balance.
 * All figures are font-mono tabular-nums; both money tiles render exact minor units via formatMoney.
 */
export function StatTiles({ summary }: { summary: OverviewSummary }) {
  const deliveryPct = summary.deliveryRate * 100;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardDescription>Messages sent</CardDescription>
            <StatIcon icon={MessageSquare} cls="bg-primary/12 text-primary" />
          </div>
          <CardTitle className="text-3xl font-mono tabular-nums">
            {summary.messagesSent.toLocaleString("en")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This month, all channels.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardDescription>Delivery rate</CardDescription>
            <StatIcon icon={CheckCheck} cls="bg-success/15 text-success" />
          </div>
          <CardTitle className="text-3xl font-mono tabular-nums">
            {deliveryPct.toFixed(1)}%
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Progress
            value={deliveryPct}
            aria-label={`Delivery rate ${deliveryPct.toFixed(1)} percent`}
            className="[&>[data-slot=progress-indicator]]:bg-success"
          />
          <p className="text-sm text-muted-foreground">
            Delivered of resolved sends.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardDescription>Spend this month</CardDescription>
            <StatIcon icon={Receipt} cls="bg-gold-subtle text-gold-ink" />
          </div>
          <CardTitle className="text-3xl font-mono tabular-nums">
            {formatMoney(summary.spendThisMonth)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Charged per delivered segment.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardDescription>Wallet balance</CardDescription>
            <StatIcon icon={Wallet} cls="bg-accent text-accent-foreground" />
          </div>
          <CardTitle className="text-3xl font-mono tabular-nums">
            {formatMoney(summary.walletBalance)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/wallet">
              Top up
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
