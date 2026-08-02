"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@app/ui/components/ui/tabs";
import type { ReactNode } from "react";

/**
 * Wallet, credits and history are three separate questions — "what can I spend", "how much money is
 * in the account", "what happened" — and stacking all three made the page a scroll.
 *
 * Alerts stay OUTSIDE the tabs on purpose: a pending purchase or a low balance has to be visible
 * whichever tab is open, or the tab that hides it becomes the one where the warning is missed.
 */
export function WalletTabs({
  defaultTab,
  credits,
  wallet,
  history,
}: {
  /** Returning from checkout opens Credits, so the thing just bought is what loads. */
  defaultTab: "credits" | "wallet";
  credits: ReactNode;
  wallet: ReactNode;
  history: ReactNode;
}) {
  return (
    <Tabs defaultValue={defaultTab} className="gap-4">
      <TabsList>
        <TabsTrigger value="credits">Credits</TabsTrigger>
        <TabsTrigger value="wallet">Wallet</TabsTrigger>
        <TabsTrigger value="history">Transactions</TabsTrigger>
      </TabsList>
      <TabsContent value="credits" className="flex flex-col gap-6">
        {credits}
      </TabsContent>
      <TabsContent value="wallet" className="flex flex-col gap-4">
        {wallet}
      </TabsContent>
      <TabsContent value="history">{history}</TabsContent>
    </Tabs>
  );
}
