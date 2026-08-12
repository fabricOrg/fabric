"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Coins, Wallet } from "lucide-react";
import { useSelectWalletTab, type WalletTab } from "./wallet-tabs";

/**
 * The two ways to pay, side by side, each one a way IN to its own tab.
 *
 * They are not alternatives to choose between — a workspace can hold both, and a send spends
 * credits FIRST and only falls back to the wallet. Without saying that plainly, buying a package
 * and then watching the wallet balance sit unchanged reads as though the money went nowhere.
 */
export function BillingOverview({
  walletBalance,
  creditSummary,
  creditsUnknown = false,
}: {
  /** Formatted wallet balance, e.g. "GHS 1,000.00", or null when the wallet holds nothing yet. */
  walletBalance: string | null;
  /** Short summary of prepaid credits, or null when there are none. */
  creditSummary: string | null;
  /** True when the balance read FAILED — "we don't know" must not render as "you have none". */
  creditsUnknown?: boolean;
}) {
  return (
    <section className="flex flex-col gap-4" aria-label="How billing works">
      <div className="grid gap-4 md:grid-cols-2">
        <RouteCard
          tab="credits"
          icon={Coins}
          title="Prepaid packages"
          description="Buy a fixed quantity for one fixed price — 20 emails and 30 SMS segments for GHS 50, say. Cheaper per message than paying as you go, and the price is locked at purchase."
          figure={
            creditSummary ?? (creditsUnknown ? "Unavailable" : "No credits yet")
          }
          caption="Spent first, on any send the package covers."
          action={creditSummary ? "View credits" : "Browse packages"}
          emphasis
        />
        <RouteCard
          tab="wallet"
          icon={Wallet}
          title="Wallet (pay as you go)"
          description="Top up money and each send is charged at your rate plan's price. No commitment, and it covers anything your packages don't."
          figure={walletBalance ?? "No funds yet"}
          caption="Used when no package credit applies."
          action="Manage wallet"
        />
      </div>

      <p className="rounded-md bg-muted/50 px-3 py-2 text-muted-foreground text-xs">
        <span className="font-medium text-foreground">
          You can use both together.
        </span>{" "}
        A send draws on package credits first and falls back to your wallet, so
        buying a package does not change your wallet balance — that money is
        held against the credits until you spend them.
      </p>
    </section>
  );
}

function RouteCard({
  tab,
  icon: Icon,
  title,
  description,
  figure,
  caption,
  action,
  emphasis = false,
}: {
  tab: WalletTab;
  icon: LucideIcon;
  title: string;
  description: string;
  figure: string;
  caption: string;
  action: string;
  emphasis?: boolean;
}) {
  const selectTab = useSelectWalletTab();
  return (
    // A real <button>, not a click handler on a div: this navigates, so it must be reachable by
    // keyboard and announced as an action.
    <button
      type="button"
      onClick={() => selectTab(tab)}
      className="rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span
              className={
                emphasis
                  ? "flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary"
                  : "flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground"
              }
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end justify-between gap-3 text-sm">
          <div>
            <p className="font-medium tabular-nums">{figure}</p>
            <p className="mt-1 text-muted-foreground text-xs">{caption}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1 font-medium text-primary text-xs">
            {action}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </span>
        </CardContent>
      </Card>
    </button>
  );
}
