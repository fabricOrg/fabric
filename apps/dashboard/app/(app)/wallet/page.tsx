import type {
  LedgerEntry,
  LedgerEntryType,
  WalletBalance,
} from "@app/contracts";
import { parseApiError } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { cn } from "@app/ui/lib/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  type LucideIcon,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { getWallet, listLedger, type Scenario } from "@/lib/mock-api";
import { formatMoney, formatSigned } from "@/lib/money";
import { TopUpDialog } from "./_top-up-dialog";

/** ?state= maps to the mock-api scenario; `loading` is UI-only (renders skeletons, no fetch). */
type ViewState = Scenario | "loading";

function parseViewState(raw: string | undefined): ViewState {
  return raw === "empty" || raw === "error" || raw === "loading"
    ? raw
    : "populated";
}

/** Ledger-kind chip — color paired with icon + label (never color-only, WCAG). */
const KIND: Record<
  LedgerEntryType,
  { label: string; icon: LucideIcon; cls: string }
> = {
  topup: {
    label: "Top-up",
    icon: ArrowDownLeft,
    cls: "bg-success/12 text-success",
  },
  refund: {
    label: "Refund",
    icon: ArrowDownLeft,
    cls: "bg-success/12 text-success",
  },
  adjustment: {
    label: "Adjustment",
    icon: BadgeCheck,
    cls: "bg-gold-subtle text-gold-ink",
  },
  sms_charge: {
    label: "SMS charge",
    icon: ArrowUpRight,
    cls: "bg-muted text-muted-foreground",
  },
};

function LedgerKindBadge({ type }: { type: LedgerEntryType }) {
  const { label, icon: Icon, cls } = KIND[type];
  return (
    <Badge variant="outline" className={cn("gap-1 border-transparent", cls)}>
      <Icon />
      {label}
    </Badge>
  );
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Wallet &amp; Billing
      </h1>
      <p className="text-sm text-muted-foreground">
        Balances, top-ups, and your double-entry transaction history.
      </p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">{children}</div>
  );
}

/** A balance is low when it has a configured threshold and sits at or below it (exact bigint compare). */
function isLow(b: WalletBalance): boolean {
  return (
    b.lowBalanceThreshold !== undefined &&
    BigInt(b.balance.minor) <= BigInt(b.lowBalanceThreshold.minor)
  );
}

export default async function WalletPage({
  searchParams,
}: {
  // Next 16: searchParams is async. `?state=empty|loading|error` demos the four global states.
  searchParams: Promise<{ state?: string }>;
}) {
  const view = parseViewState((await searchParams).state);

  if (view === "loading") {
    return (
      <Shell>
        <PageHeader />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </Shell>
    );
  }

  let balances: readonly WalletBalance[];
  let ledger: readonly LedgerEntry[];
  try {
    [balances, ledger] = await Promise.all([getWallet(view), listLedger(view)]);
  } catch (payload) {
    const err = parseApiError(payload);
    return (
      <Shell>
        <PageHeader />
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load your wallet</AlertTitle>
          <AlertDescription>
            <p>{err.message}</p>
            {err.requestId && (
              <p>
                Contact support with{" "}
                <code className="font-mono">{err.requestId}</code>.
              </p>
            )}
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (balances.length === 0) {
    return (
      <Shell>
        <PageHeader />
        <Empty className="mx-auto max-w-2xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>No funds yet</EmptyTitle>
            <EmptyDescription>
              Top up your wallet to start sending. You&apos;re charged per
              delivered segment — no monthly fees.
            </EmptyDescription>
          </EmptyHeader>
          <TopUpDialog />
        </Empty>
      </Shell>
    );
  }

  const low = balances.filter(isLow);
  const primaryCurrency = balances[0]?.balance.currency ?? "GHS";

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader />
        <div className="flex gap-2">
          <TopUpDialog defaultCurrency={primaryCurrency} />
          <Button variant="outline" size="sm">
            <Bell data-icon="inline-start" />
            Alerts
          </Button>
        </div>
      </div>

      {low.length > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Low balance</AlertTitle>
          <AlertDescription>
            {low.map((b) => (
              <p key={b.balance.currency}>
                <span className="font-medium text-foreground">
                  {b.balance.currency}
                </span>{" "}
                is at{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {formatMoney(b.balance)}
                </span>
                {b.lowBalanceThreshold && (
                  <>
                    , below your {formatMoney(b.lowBalanceThreshold)} alert
                    threshold
                  </>
                )}
                . Top up to avoid interrupted sends.
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {balances.map((b) => (
          <Card key={b.balance.currency}>
            <CardHeader>
              <CardDescription>{b.balance.currency} balance</CardDescription>
              <CardTitle className="font-display text-3xl tabular-nums">
                {formatMoney(b.balance)}
              </CardTitle>
              {isLow(b) && (
                <CardAction>
                  <Badge
                    variant="outline"
                    className="gap-1 border-transparent bg-warning/15 text-warning"
                  >
                    <TriangleAlert />
                    Low
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>
            Top-ups, SMS charges, refunds, and adjustments — with running
            balance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <span className="font-medium">{KIND[e.type].label}</span>
                      {e.reference && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {e.reference}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <LedgerKindBadge type={e.type} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        e.direction === "credit"
                          ? "text-success"
                          : "text-foreground",
                      )}
                    >
                      {formatSigned(e.amount, e.direction)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatMoney(e.runningBalance)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {new Date(e.createdAt).toLocaleDateString("en", {
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
