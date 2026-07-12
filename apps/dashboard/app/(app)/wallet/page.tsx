import type {
  LedgerEntry,
  LedgerEntryType,
  WalletBalance,
} from "@app/contracts";
import { parseApiError, toMoney } from "@app/contracts";
import { DEFAULT_RATES, rateSegments } from "@app/domain";
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
import { Separator } from "@app/ui/components/ui/separator";
import { TableEmptyRow } from "@app/ui/components/ui/states";
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
  CheckCircle2,
  Clock,
  CreditCard,
  type LucideIcon,
  Repeat,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { AutoTopupDialog } from "@/components/forms/auto-topup-dialog";
import { TopUpDialog } from "@/components/forms/top-up-dialog";
import { BalanceTrend } from "@/components/wallet/balance-trend";
import { formatMoney, formatSigned } from "@/lib/money";
import {
  getAutoTopup,
  getSavedPaymentMethod,
  getWalletSnapshot,
} from "@/lib/server/dashboard-data";

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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Wallet &amp; Billing
        </h1>
        <p className="text-sm text-muted-foreground">
          Balances, top-ups, and your double-entry transaction history.
        </p>
      </div>
      {/* B1: the auditable statement — every line a ledger leg, opening/closing balanced. */}
      <Button asChild variant="outline" size="sm">
        <a href="/api/dashboard/wallet/statement" download>
          Export statement (CSV)
        </a>
      </Button>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-col gap-6">{children}</div>;
}

/** A balance is low when it has a configured threshold and sits at or below it (exact bigint compare). */
function isLow(b: WalletBalance): boolean {
  return (
    b.lowBalanceThreshold !== undefined &&
    BigInt(b.balance.minor) <= BigInt(b.lowBalanceThreshold.minor)
  );
}

/** Runway = how many SMS segments this balance buys at the standard rate (exact bigint division). */
function messageRunway(b: WalletBalance) {
  let rateMinor = 0n;
  try {
    rateMinor = rateSegments(1, b.balance.currency, DEFAULT_RATES);
  } catch {
    return null;
  }
  if (rateMinor <= 0n) return null;
  return {
    count: Number(BigInt(b.balance.minor) / rateMinor),
    rate: toMoney(rateMinor, b.balance.currency),
  };
}

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{
    payment_return?: string;
    reference?: string;
    trxref?: string;
  }>;
}) {
  const paymentParams = await searchParams;
  let balances: readonly WalletBalance[];
  let ledger: readonly LedgerEntry[];
  // Best-effort: a missing saved card just shows the Paystack fallback, never blocks the page.
  const savedMethod = await getSavedPaymentMethod()
    .then((r) => r.method)
    .catch(() => null);
  // Best-effort too: never blocks the wallet if the auto-top-up read fails.
  const autoTopup = await getAutoTopup().catch(() => ({
    config: null,
    has_card: Boolean(savedMethod),
  }));
  try {
    const snapshot = await getWalletSnapshot();
    balances = snapshot.balances;
    ledger = snapshot.ledger;
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
  const paymentReference =
    paymentParams.reference ?? paymentParams.trxref ?? null;
  const paymentCredited = paymentReference
    ? ledger.some(
        (entry) =>
          entry.type === "topup" && entry.reference === paymentReference,
      )
    : false;
  const primaryCurrency = balances[0]?.balance.currency ?? "GHS";
  // "This month" spend = Σ|sms_charge| (exact bigint minor units, never float).
  const monthSpendMinor = ledger
    .filter((e) => e.type === "sms_charge")
    .reduce((sum, e) => {
      const m = BigInt(e.amount.minor);
      return sum + (m < 0n ? -m : m);
    }, 0n);
  const monthSpend = toMoney(monthSpendMinor, primaryCurrency);

  // Running-balance series (chronological) for the trend chart. Number is display-only — the exact
  // money stays in bigint minor units on `runningBalance`.
  const balancePoints = [...ledger]
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .map((e) => ({
      label: new Date(e.createdAt).toLocaleDateString("en", {
        month: "short",
        day: "numeric",
      }),
      balance: Number(e.runningBalance.minor) / 100,
    }));

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

      {paymentParams.payment_return === "1" ? (
        <Alert>
          {paymentCredited ? <CheckCircle2 /> : <Clock />}
          <AlertTitle>
            {paymentCredited
              ? "Top-up confirmed"
              : "Payment confirmation is processing"}
          </AlertTitle>
          <AlertDescription>
            {paymentCredited
              ? "Paystack confirmed the payment and the credit is present in your wallet ledger."
              : "Returning from checkout does not confirm payment. We are waiting for Paystack's signed webhook before crediting your balance."}
            {paymentReference ? (
              <span className="mt-1 block text-xs">
                Payment reference:{" "}
                <code className="font-mono">{paymentReference}</code>
              </span>
            ) : null}
            {!paymentCredited ? (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="mt-3 w-fit"
              >
                <Link
                  href={`/wallet?payment_return=1${
                    paymentReference
                      ? `&reference=${encodeURIComponent(paymentReference)}`
                      : ""
                  }`}
                >
                  Check again
                </Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

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
        {balances.map((b) => {
          const runway = messageRunway(b);
          const isPrimary = b.balance.currency === primaryCurrency;
          return (
            <Card key={b.balance.currency} className="flex flex-col">
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
              <CardContent className="mt-auto flex flex-col gap-3 text-sm">
                {runway && (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-lg font-semibold tabular-nums">
                      ≈ {runway.count.toLocaleString("en")} SMS
                    </span>
                    <span className="text-xs text-muted-foreground">
                      left at {formatMoney(runway.rate)} / segment
                    </span>
                  </div>
                )}
                {isPrimary && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Spent this month
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatMoney(monthSpend)}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
        <BalanceTrend points={balancePoints} currency={primaryCurrency} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Auto top-up</CardTitle>
            <CardDescription>Never run out mid-campaign.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              {autoTopup.config?.enabled ? (
                <>
                  <Badge
                    variant="outline"
                    className="w-fit gap-1 border-transparent bg-success/12 text-success"
                  >
                    <Repeat />
                    On
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    At{" "}
                    {formatMoney({
                      currency: autoTopup.config.currency,
                      minor: autoTopup.config.threshold_minor,
                    })}
                    , add{" "}
                    {formatMoney({
                      currency: autoTopup.config.currency,
                      minor: autoTopup.config.top_up_minor,
                    })}
                    .
                  </span>
                </>
              ) : (
                <>
                  <Badge
                    variant="outline"
                    className="w-fit gap-1 border-transparent bg-muted text-muted-foreground"
                  >
                    <Repeat />
                    Off
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {autoTopup.has_card
                      ? "Charge your saved card automatically."
                      : "Pay once by card to enable."}
                  </span>
                </>
              )}
            </div>
            <AutoTopupDialog
              config={autoTopup.config}
              hasCard={autoTopup.has_card}
              defaultCurrency={primaryCurrency}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment method</CardTitle>
            <CardDescription>How top-ups are charged.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-start gap-2">
            <CreditCard className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {savedMethod ? (
              <div className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium capitalize">
                  {savedMethod.brand ?? "Card"} ••••{" "}
                  {savedMethod.last4 ?? "····"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {savedMethod.exp ? `Expires ${savedMethod.exp} · ` : ""}
                  Saved via Paystack · reused for auto top-up
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Secured by Paystack — you&apos;re redirected to a hosted
                checkout (card or mobile money) for each top-up. No card is
                stored on Fabric. Pay once by card to enable auto top-up.
              </p>
            )}
          </CardContent>
        </Card>
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
          {/* Semantic <section> so the scroll region is keyboard-focusable (tabIndex) — running-balance
              columns reachable without a mouse (WCAG 2.1.1 / axe scrollable-region-focusable, QA-DS-4). */}
          <section
            className="overflow-x-auto"
            tabIndex={0}
            aria-label="Transaction history"
          >
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
                {ledger.length === 0 ? (
                  <TableEmptyRow
                    columns={5}
                    icon={<Wallet />}
                    title="No billing transactions yet"
                    description="Top-ups, message charges, refunds, and adjustments will appear here."
                  />
                ) : (
                  ledger.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <span className="font-medium">
                          {KIND[e.type].label}
                        </span>
                        {e.reference &&
                          (e.type === "sms_charge" ? (
                            <Link
                              href={`/messages?messageId=${encodeURIComponent(e.reference)}`}
                              className="block font-mono text-xs text-primary hover:underline"
                            >
                              View message {e.reference}
                            </Link>
                          ) : (
                            <span className="block font-mono text-xs text-muted-foreground">
                              {e.reference}
                            </span>
                          ))}
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
                  ))
                )}
              </TableBody>
            </Table>
          </section>
        </CardContent>
      </Card>
    </Shell>
  );
}
