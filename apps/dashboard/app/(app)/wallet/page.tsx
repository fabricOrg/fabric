import type { LedgerEntry, WalletBalance } from "@app/contracts";
import {
  currency as currencySchema,
  parseApiError,
  toMoney,
} from "@app/contracts";
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
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { Separator } from "@app/ui/components/ui/separator";
import { EmptyState, ErrorState } from "@app/ui/components/ui/states";
import { formatDayMonth } from "@app/ui/lib/datetime";
import {
  CheckCircle2,
  Clock,
  CreditCard,
  Repeat,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoTopupDialog } from "@/components/forms/auto-topup-dialog";
import { TopUpDialog } from "@/components/forms/top-up-dialog";
import { CommercialOfferCatalog } from "@/components/tokens/commercial-offer-catalog";
import { CreditBalances } from "@/components/tokens/credit-balances";
import { CreditsPanel } from "@/components/tokens/credits-panel";
import { BalanceTrend } from "@/components/wallet/balance-trend";
import { BillingOverview } from "@/components/wallet/billing-overview";
import {
  PackagePurchasesCard,
  WalletLedgerCard,
} from "@/components/wallet/transactions-panel";
import { WalletTabs } from "@/components/wallet/wallet-tabs";
import { formatMoney } from "@/lib/money";
import { requireDashboardSession } from "@/lib/server/auth";
import {
  getAutoTopup,
  getCommercialOfferCatalog,
  getCommercialOfferPurchaseReceipt,
  getCommercialOfferPurchases,
  getSavedPaymentMethod,
  getTokenBalances,
  getWalletSnapshot,
} from "@/lib/server/dashboard-data";
import { parseWalletTab } from "@/lib/wallet-tab";

/** The heading block, identical in every state the page can render (loaded, empty, failed). */
function WalletHeading({ actions }: { actions?: React.ReactNode }) {
  return (
    <PageHeader className="border-b pb-4">
      <PageHeaderHeading>
        <PageHeaderTitle className="text-3xl">
          Wallet &amp; Billing
        </PageHeaderTitle>
        <PageHeaderDescription>
          Balances, top-ups, and your double-entry transaction history.
        </PageHeaderDescription>
      </PageHeaderHeading>
      {actions ? <PageHeaderActions>{actions}</PageHeaderActions> : null}
    </PageHeader>
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
    tokens?: string;
    trxref?: string;
    tab?: string;
  }>;
}) {
  const session = await requireDashboardSession();
  if (session.plan === "sandbox") redirect("/");
  const paymentParams = await searchParams;
  const [catalogResult, tokenBalancesResult, purchaseResult] =
    await Promise.allSettled([
      getCommercialOfferCatalog(),
      getTokenBalances(),
      getCommercialOfferPurchases(),
    ]);
  // Best-effort: an unreadable purchase history renders as empty rather than taking the wallet down
  // with it. The credits themselves are read from the balances above.
  const purchases =
    purchaseResult.status === "fulfilled" ? purchaseResult.value.purchases : [];
  const canPurchase = session.role === "owner" || session.role === "admin";
  const commercialSection =
    catalogResult.status === "fulfilled" &&
    tokenBalancesResult.status === "fulfilled" ? (
      <CommercialOfferCatalog
        catalog={catalogResult.value}
        canPurchase={canPurchase}
      />
    ) : (
      <ErrorState
        title="Couldn't load prepaid packages"
        message="Your wallet remains available. Refresh before attempting a package purchase."
      />
    );
  const tokenReceipt =
    paymentParams.tokens === "1" && paymentParams.reference
      ? await getCommercialOfferPurchaseReceipt(paymentParams.reference).catch(
          () => null,
        )
      : null;
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
    // One state, not two. `commercialSection` is ITSELF an ErrorState when the catalog read fails, and
    // both reads share a session — so a 500 or a lapsed token stacked two destructive alerts on one
    // page. The token receipt still renders: it is the only answer to "did my money do anything?", and
    // a failed wallet read is exactly when that question gets asked.
    return (
      <Shell>
        <WalletHeading />
        {tokenReceipt ? <TokenPurchaseNotice receipt={tokenReceipt} /> : null}
        <ErrorState
          title="Couldn't load your wallet"
          message={err.message}
          {...(err.requestId ? { requestId: err.requestId } : {})}
        />
        <Button asChild variant="outline" size="sm" className="w-fit">
          {/* Keeps the receipt params: a bare /wallet would strip ?tokens=&reference= and drop the
              TokenPurchaseNotice rendered directly above this. */}
          <Link
            href={
              paymentParams.tokens === "1" && paymentParams.reference
                ? `/wallet?tokens=1&reference=${encodeURIComponent(paymentParams.reference)}`
                : "/wallet"
            }
          >
            Check again
          </Link>
        </Button>
        {/* Kept when the CATALOG read succeeded: it is the only route to buying a package anywhere in
            the dashboard, the two reads are independent, and gating on its health gives one error
            state without costing the capability. */}
        {/* BOTH, because commercialSection is itself an ErrorState unless both reads succeeded —
            gating on the catalog alone still allowed a second error state through. */}
        {catalogResult.status === "fulfilled" &&
        tokenBalancesResult.status === "fulfilled"
          ? commercialSection
          : null}
      </Shell>
    );
  }

  // No early return for the zero-balance case, deliberately. It used to render its own reduced shell —
  // no tabs, the package catalog hoisted to the top level beside a second page-level empty — so a
  // funded wallet and an empty one were two different information architectures, and the first top-up
  // visibly reorganised the page. Empty is a state of THIS layout: same header, same tabs, and each
  // tab owns its own empty (the catalog's lives in Credits, where the thing it describes lives).
  const hasFunds = balances.length > 0;
  const low = balances.filter(isLow);
  const paymentReference =
    paymentParams.reference ?? paymentParams.trxref ?? null;
  const paymentCredited = paymentReference
    ? ledger.some(
        (entry) =>
          entry.type === "topup" && entry.reference === paymentReference,
      )
    : false;
  // Derived, never assumed. This feeds TopUpDialog's defaultCurrency, which seeds the POST body that
  // reaches Paystack — so a wrong guess CHARGES in the wrong currency on a workspace's first top-up,
  // and credits a balance no package can be bought with (the catalog is filtered to billing_currency).
  // The catalog is already server-filtered to accounts.billing_currency, so its offers carry the real
  // value; token balances carry it too. "GHS" survives only as a last resort when every read is empty.
  const catalogCurrency =
    catalogResult.status === "fulfilled"
      ? catalogResult.value.offers[0]?.currency
      : undefined;
  // tokenBalanceDto types currency as a bare string, so it is narrowed through the contract's own
  // schema rather than cast — an unrecognised value must fall through, not become the charged currency.
  const tokenCurrencyRaw =
    tokenBalancesResult.status === "fulfilled"
      ? tokenBalancesResult.value.balances[0]?.currency
      : undefined;
  const tokenCurrency = currencySchema.safeParse(tokenCurrencyRaw).data;
  // Catalog FIRST. It is the only source tied to accounts.billing_currency (token-catalog.service.ts
  // filters offers by it). The wallet balance is not "primary" at all — customer-reads orders ledger
  // accounts ALPHABETICALLY by currency, so balances[0] is whichever sorts first, and a workspace that
  // ever acquires a stray GHS account would pin every later top-up to GHS.
  const primaryCurrency =
    catalogCurrency ?? balances[0]?.balance.currency ?? tokenCurrency ?? "GHS";
  const primaryBalance = balances[0]?.balance;
  const tokenBalances =
    tokenBalancesResult.status === "fulfilled"
      ? tokenBalancesResult.value.balances.filter(
          (balance) => BigInt(balance.available) > 0n,
        )
      : [];
  const creditsUnknown = tokenBalancesResult.status === "rejected";
  const creditSummary =
    tokenBalances.length === 0
      ? null
      : tokenBalances
          .map(
            (balance) =>
              `${BigInt(balance.available).toLocaleString("en")} ${balance.channel}`,
          )
          .join(" · ");
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
      label: formatDayMonth(e.createdAt),
      balance: Number(e.runningBalance.minor) / 100,
    }));

  return (
    <Shell>
      <WalletHeading
        actions={
          // The "Alerts" button that used to sit here had no handler and no href. It was only ever
          // rendered for a funded wallet; removing the empty branch would have shipped a dead control
          // into the first-run view.
          <TopUpDialog defaultCurrency={primaryCurrency} />
        }
      />

      {tokenReceipt ? <TokenPurchaseNotice receipt={tokenReceipt} /> : null}

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

      <WalletTabs
        // An explicit ?tab= wins; otherwise a fresh token receipt opens Credits so the purchase
        // you just made is the panel you land on.
        defaultTab={
          parseWalletTab(paymentParams.tab) ??
          (tokenReceipt ? "credits" : "overview")
        }
        overview={
          <BillingOverview
            // null, not a fabricated zero: this fallback was unreachable until the empty branch was
            // removed, and it invents a currency — the workspace's real billing_currency (GHS|NGN|USD)
            // is never exposed to the dashboard, so a Nigerian workspace was shown cedis.
            walletBalance={primaryBalance ? formatMoney(primaryBalance) : null}
            creditSummary={creditSummary}
            creditsUnknown={creditsUnknown}
          />
        }
        credits={
          <>
            {tokenBalancesResult.status === "fulfilled" ? (
              <CreditBalances balances={tokenBalancesResult.value.balances} />
            ) : null}

            <CreditsPanel
              purchaseCount={purchases.length}
              catalog={commercialSection}
              history={<PackagePurchasesCard purchases={purchases} />}
            />
          </>
        }
        wallet={
          !hasFunds ? (
            // The ONE empty this page shows for an unfunded wallet, and it is the actionable one. The
            // balance cards, trend and ledger are all projections of rows that do not exist yet, so
            // rendering them as zeros would be four empties dressed as content.
            <EmptyState
              icon={<Wallet />}
              title="No funds yet"
              description="Top up your wallet to start sending. You're charged per delivered segment — no monthly fees."
              action={<TopUpDialog defaultCurrency={primaryCurrency} />}
            />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                {balances.map((b) => {
                  const runway = messageRunway(b);
                  const isPrimary = b.balance.currency === primaryCurrency;
                  return (
                    <Card key={b.balance.currency} className="flex flex-col">
                      <CardHeader>
                        <CardDescription>
                          {b.balance.currency} balance
                        </CardDescription>
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
                <BalanceTrend
                  points={balancePoints}
                  currency={primaryCurrency}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Auto top-up</CardTitle>
                    <CardDescription>
                      Never run out mid-campaign.
                    </CardDescription>
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
                          {savedMethod.exp
                            ? `Expires ${savedMethod.exp} · `
                            : ""}
                          Saved via Paystack · reused for auto top-up
                        </span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Secured by Paystack — you&apos;re redirected to a hosted
                        checkout (card or mobile money) for each top-up. No card
                        is stored on Fabric. Pay once by card to enable auto
                        top-up.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <WalletLedgerCard ledger={ledger} />
            </>
          )
        }
      />
    </Shell>
  );
}

function TokenPurchaseNotice({
  receipt,
}: {
  readonly receipt: Awaited<
    ReturnType<typeof getCommercialOfferPurchaseReceipt>
  >;
}) {
  const confirmed = receipt.status === "success";
  const failed = receipt.status === "failed";
  let title = "Token purchase is processing";
  let description =
    "Returning from checkout does not grant tokens. We are waiting for Paystack's signed webhook.";
  if (confirmed) {
    title = "Token purchase confirmed";
    const credits = receipt.items
      .map(
        (item) =>
          `${BigInt(item.quantity).toLocaleString("en")} ${item.unit_code}`,
      )
      .join(" and ");
    description = `${credits} were credited from ${receipt.offer_name}.`;
  }
  if (failed) {
    title = "Token purchase failed";
    description =
      "Paystack did not confirm this purchase. No tokens were credited.";
  }
  return (
    <Alert variant={failed ? "destructive" : "default"}>
      {confirmed ? <CheckCircle2 /> : <Clock />}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
        <p className="mt-1 text-xs">
          Reference: <code className="font-mono">{receipt.reference}</code>
        </p>
        {!confirmed && !failed ? (
          <Button asChild variant="outline" size="sm" className="mt-3 w-fit">
            <Link
              href={`/wallet?tokens=1&reference=${encodeURIComponent(receipt.reference)}`}
            >
              Check again
            </Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
