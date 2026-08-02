import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { formatDayMonth } from "@app/ui/lib/datetime";
import { cn } from "@app/ui/lib/utils";
import {
  ArrowUpRight,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { OverviewActivity } from "@/lib/client/overview-api";

/** Kind → icon + label. Colour is never the only signal (icon + text always accompany it). */
const KIND: Record<
  OverviewActivity["kind"],
  { icon: LucideIcon; label: string; cls: string }
> = {
  message: {
    icon: MessageSquare,
    label: "Message",
    cls: "bg-primary/12 text-primary",
  },
  campaign: {
    icon: Megaphone,
    label: "Campaign",
    cls: "bg-gold-subtle text-gold-ink",
  },
  topup: { icon: Wallet, label: "Top-up", cls: "bg-success/15 text-success" },
};

/** Free-form status string → a paired token tint (falls back to neutral for unknown statuses). */
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (["delivered", "completed", "sent"].includes(s))
    return "bg-success/12 text-success";
  if (["failed", "undelivered", "expired"].includes(s))
    return "bg-destructive/12 text-destructive";
  if (["sending", "queued", "accepted", "pending"].includes(s))
    return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
}

/** Compact, dependency-free relative time (e.g. "just now", "3h ago", "Jul 3"). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDayMonth(iso);
}

function Row({ item }: { item: OverviewActivity }) {
  const kind = KIND[item.kind];
  const Icon = kind.icon;
  return (
    <div className="flex items-center gap-3 py-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
          kind.cls,
        )}
      >
        <Icon aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{item.label}</span>
        <span className="text-xs text-muted-foreground">
          {kind.label} · {relativeTime(item.at)}
        </span>
      </div>
      <Badge
        variant="outline"
        className={cn(
          "shrink-0 border-transparent capitalize",
          statusClass(item.status),
        )}
      >
        {item.status}
      </Badge>
    </div>
  );
}

function activityHref(item: OverviewActivity): string {
  if (item.kind === "message") {
    return `/messages?messageId=${encodeURIComponent(item.id)}`;
  }
  return item.kind === "campaign" ? "/campaigns" : "/wallet";
}

/**
 * Compact recent-activity feed. Message rows link to /messages (the drill-down surface); campaign and
 * top-up rows are non-navigable here. Divided list keeps it scannable without a full table.
 */
export function RecentActivity({
  items,
}: {
  items: readonly OverviewActivity[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>
          Latest messages, campaigns, and top-ups.
        </CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/messages">
              View all
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={activityHref(item)}
                className="-mx-2 block rounded-md px-2 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Row item={item} />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
