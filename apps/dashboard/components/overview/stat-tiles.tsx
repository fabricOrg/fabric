import { Button } from "@app/ui/components/ui/button";
import { Progress } from "@app/ui/components/ui/progress";
import { StatCard } from "@app/ui/components/ui/stat-card";
import {
  ArrowUpRight,
  CheckCheck,
  MessageSquare,
  Receipt,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { OverviewSummary } from "@/lib/client/overview-api";
import { formatMoney } from "@/lib/money";

/**
 * The at-a-glance row: messages sent, delivery rate, spend this month, wallet balance — all on the
 * shared StatCard. Figures are mono/tabular; both money tiles render exact minor units via formatMoney.
 */
export function StatTiles({ summary }: { summary: OverviewSummary }) {
  const deliveryPct = summary.deliveryRate * 100;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Messages sent"
        value={summary.messagesSent.toLocaleString("en")}
        icon={MessageSquare}
        iconClassName="bg-primary/12 text-primary"
      >
        <p className="text-sm text-muted-foreground">
          This month, all channels.
        </p>
      </StatCard>

      <StatCard
        label="Delivery rate"
        value={`${deliveryPct.toFixed(1)}%`}
        icon={CheckCheck}
        iconClassName="bg-success/15 text-success"
      >
        <Progress
          value={deliveryPct}
          aria-label={`Delivery rate ${deliveryPct.toFixed(1)} percent`}
          className="[&>[data-slot=progress-indicator]]:bg-success"
        />
        <p className="text-sm text-muted-foreground">
          Delivered of resolved sends.
        </p>
      </StatCard>

      <StatCard
        label="Spend this month"
        value={formatMoney(summary.spendThisMonth)}
        icon={Receipt}
        iconClassName="bg-gold-subtle text-gold-ink"
      >
        <p className="text-sm text-muted-foreground">
          Charged per delivered segment.
        </p>
      </StatCard>

      <StatCard
        label="Wallet balance"
        value={formatMoney(summary.walletBalance)}
        icon={Wallet}
        iconClassName="bg-accent text-accent-foreground"
      >
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link href="/wallet">
            Top up
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      </StatCard>
    </div>
  );
}
