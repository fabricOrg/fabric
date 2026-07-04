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
import { StatusBadge } from "@/components/status-badge";
import { formatMoney } from "@/lib/money";
import { getMessageList, getWalletSnapshot } from "@/lib/server/dashboard-data";

export default async function OverviewPage() {
  const [{ balances }, { messages }] = await Promise.all([
    getWalletSnapshot(),
    getMessageList(),
  ]);
  const primary = balances[0]?.balance;
  const recent = messages.slice(0, 5);
  const now = new Date();
  const today = messages.filter((message) => {
    const created = new Date(message.createdAt);
    return (
      created.getUTCFullYear() === now.getUTCFullYear() &&
      created.getUTCMonth() === now.getUTCMonth() &&
      created.getUTCDate() === now.getUTCDate()
    );
  });
  const delivered = today.filter(
    (message) => message.status === "delivered",
  ).length;
  const inFlight = today.filter((message) =>
    ["queued", "sending", "accepted", "sent"].includes(message.status),
  ).length;
  const resolved = today.filter((message) =>
    ["delivered", "undelivered", "failed", "expired"].includes(message.status),
  ).length;
  const deliveryRate = resolved === 0 ? 0 : (delivered / resolved) * 100;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Overview
        </h1>
        <p className="text-sm text-muted-foreground">
          Your wallet, today&apos;s traffic, and recent messages at a glance.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Available balance</CardDescription>
            <CardTitle className="font-display text-3xl tabular-nums">
              {primary ? formatMoney(primary) : "No wallet"}
            </CardTitle>
            <CardAction>
              <span className="text-xs text-muted-foreground">
                {balances.length}{" "}
                {balances.length === 1 ? "currency" : "currencies"}
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
              {today.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {delivered} delivered · {inFlight} in flight
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Delivery rate · today</CardDescription>
            <CardTitle className="font-display text-3xl tabular-nums">
              {deliveryRate.toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Progress
              value={deliveryRate}
              aria-label={`Delivery rate ${deliveryRate.toFixed(1)} percent`}
            />
            <p className="text-sm text-muted-foreground">
              {resolved} resolved message{resolved === 1 ? "" : "s"}.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent messages</CardTitle>
          <CardDescription>
            The latest sends across your account.
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
                  <TableHead className="hidden text-right sm:table-cell">
                    Segments
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Cost
                  </TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    Time
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((message) => (
                  <TableRow key={message.id}>
                    <TableCell className="font-mono text-sm">
                      {message.to}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={message.status} />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {message.segments}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                      {formatMoney(message.cost)}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground md:table-cell">
                      {new Date(message.createdAt).toLocaleTimeString("en", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
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
