"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@app/ui/components/ui/tabs";
import { createContext, type ReactNode, useContext, useState } from "react";

export type WalletTab = "overview" | "credits" | "wallet" | "history";

/**
 * Lets content INSIDE a tab move to another one — the overview cards are signposts, so they have to
 * be able to send you where they point. Tabs are controlled here rather than by Radix's uncontrolled
 * default, because that is the only way a child can change the selection.
 */
const SelectTabContext = createContext<((tab: WalletTab) => void) | null>(null);

export function useSelectWalletTab(): (tab: WalletTab) => void {
  // No-op outside the provider so a card is never a dead button in an unexpected tree.
  return useContext(SelectTabContext) ?? (() => {});
}

/**
 * Wallet, credits and history are separate questions — "what can I spend", "how much money is in
 * the account", "what happened" — and stacking all of them made the page one long scroll.
 *
 * Alerts stay OUTSIDE the tabs on purpose: a pending purchase or a low balance has to be visible
 * whichever tab is open, or the tab that hides it becomes the one where the warning is missed.
 */
export function WalletTabs({
  defaultTab,
  overview,
  credits,
  wallet,
  history,
}: {
  /** Returning from checkout opens Credits, so the thing just bought is what loads. */
  defaultTab: WalletTab;
  overview: ReactNode;
  credits: ReactNode;
  wallet: ReactNode;
  history: ReactNode;
}) {
  const [tab, setTab] = useState<WalletTab>(defaultTab);

  return (
    <SelectTabContext.Provider value={setTab}>
      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as WalletTab)}
        className="gap-4"
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="wallet">Wallet</TabsTrigger>
          <TabsTrigger value="history">Transactions</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">{overview}</TabsContent>
        <TabsContent value="credits" className="flex flex-col gap-6">
          {credits}
        </TabsContent>
        <TabsContent value="wallet" className="flex flex-col gap-4">
          {wallet}
        </TabsContent>
        <TabsContent value="history">{history}</TabsContent>
      </Tabs>
    </SelectTabContext.Provider>
  );
}
