import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { OverviewSummary } from "@/lib/client/overview-api";
import type { SenderId } from "@/lib/client/senders-api";

interface AttentionItem {
  title: string;
  description: string;
  href: string;
  action: string;
}

function buildItems(
  summary: OverviewSummary,
  senders: readonly SenderId[],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const failed = summary.recentActivity.filter((item) =>
    ["failed", "undelivered"].includes(item.status.toLowerCase()),
  ).length;
  const rejected = senders.filter(
    (sender) => sender.status === "rejected",
  ).length;

  if (failed > 0)
    items.push({
      title: `${failed} recent failure${failed === 1 ? "" : "s"}`,
      description: "Inspect the delivery record before retrying.",
      href: "/messages?status=failed",
      action: "Review messages",
    });
  if (rejected > 0)
    items.push({
      title: `${rejected} rejected sender ID${rejected === 1 ? "" : "s"}`,
      description: "Review the carrier reason and correct the registration.",
      href: "/senders?status=rejected",
      action: "Resolve sender IDs",
    });
  if (BigInt(summary.walletBalance.minor) <= 0n)
    items.push({
      title: "Wallet needs funding",
      description: "Add funds before attempting a production send.",
      href: "/wallet",
      action: "Fund wallet",
    });
  return items;
}

export function AttentionQueue({
  summary,
  senders = [],
}: {
  summary: OverviewSummary;
  senders?: readonly SenderId[];
}) {
  const items = buildItems(summary, senders);
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>
          Operational issues that may block sending or require recovery.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border rounded-md border">
          {items.map((item) => (
            <li
              key={item.title}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
            >
              <AlertTriangle className="size-5 shrink-0 text-warning-strong" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={item.href}>
                  {item.action}
                  <ArrowUpRight data-icon="inline-end" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
