import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Progress } from "@app/ui/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import { type MessageStatus, StatusBadge } from "@/components/status-badge";

interface RecentMessage {
  to: string;
  status: MessageStatus;
  segments: number;
  cost: string;
  time: string;
}

const RECENT: readonly RecentMessage[] = [
  {
    to: "+233 24● ●●● ●●12",
    status: "delivered",
    segments: 1,
    cost: "0.03",
    time: "2 min ago",
  },
  {
    to: "+234 80● ●●● ●●45",
    status: "sent",
    segments: 2,
    cost: "0.06",
    time: "6 min ago",
  },
  {
    to: "+233 20● ●●● ●●88",
    status: "delivered",
    segments: 1,
    cost: "0.03",
    time: "14 min ago",
  },
  {
    to: "+233 27● ●●● ●●03",
    status: "undelivered",
    segments: 1,
    cost: "0.03",
    time: "22 min ago",
  },
  {
    to: "+233 55● ●●● ●●71",
    status: "failed",
    segments: 1,
    cost: "0.03",
    time: "31 min ago",
  },
];

export default function OverviewPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Overview
        </h1>
        <p className="text-sm text-muted-foreground">
          Your wallet, today's traffic, and recent messages at a glance.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardDescription>Available balance</CardDescription>
            <CardTitle className="font-display text-3xl tabular-nums">
              GHS 1,204.03
            </CardTitle>
            <CardAction>
              <span className="text-xs text-muted-foreground">
                2 currencies
              </span>
            </CardAction>
          </CardHeader>
          <CardFooter className="gap-2">
            <Button asChild size="sm">
              <Link href="/wallet">
                <Plus data-icon="inline-start" />
                Top up
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/wallet">Transactions</Link>
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Sent today</CardDescription>
            <CardTitle className="font-display text-3xl tabular-nums">
              2,318
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              2,276 delivered · 42 in flight
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Delivery rate · 24h</CardDescription>
            <CardTitle className="font-display text-3xl tabular-nums">
              98.2%
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Progress value={98} aria-label="Delivery rate 98.2 percent" />
            <p className="text-sm text-muted-foreground">
              Above your 95% target.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent messages</CardTitle>
          <CardDescription>
            The last few sends across your account.
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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Segments</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {RECENT.map((m) => (
                  <TableRow key={m.to}>
                    <TableCell className="font-mono text-sm">{m.to}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.segments}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      GHS {m.cost}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {m.time}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
