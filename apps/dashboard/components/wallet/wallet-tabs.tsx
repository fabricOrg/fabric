"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@app/ui/components/ui/tabs";
import { useUrlTabState } from "@app/ui/hooks/use-url-tab-state";
import { createContext, type ReactNode, useContext } from "react";
import { WALLET_TABS, type WalletTab } from "@/lib/wallet-tab";

// Re-exported for the components that already import the type from here. The VALUES stay in
// `@/lib/wallet-tab`, which has no "use client" — the server must be able to call the parser.
export type { WalletTab };

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
 * Credits and wallet are separate questions — "what can I send for free" versus "how much money is
 * in the account" — and stacking both made the page one long scroll.
 *
 * Each tab carries its OWN history: the ledger sits under the wallet, package purchases sit under
 * the packages. A shared "Transactions" tab would have forced every history hunt through a second
 * hop, and would have implied purchases move the wallet balance, which they do not.
 *
 * Alerts stay OUTSIDE the tabs on purpose: a pending purchase or a low balance has to be visible
 * whichever tab is open, or the tab that hides it becomes the one where the warning is missed.
 */
export function WalletTabs({
  defaultTab,
  overview,
  credits,
  wallet,
}: {
  /**
   * Resolved on the SERVER from `?tab=`, falling back to Credits when returning from checkout so
   * the thing just bought is what loads. Passing it in (rather than reading the URL here) is what
   * keeps the first paint identical on both sides of hydration.
   */
  defaultTab: WalletTab;
  overview: ReactNode;
  credits: ReactNode;
  wallet: ReactNode;
}) {
  const [tab, setTab] = useUrlTabState<WalletTab>(
    "tab",
    defaultTab,
    WALLET_TABS,
  );

  return (
    <SelectTabContext.Provider value={setTab}>
      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as WalletTab)}
        className="gap-6"
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="wallet">Wallet</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">{overview}</TabsContent>
        <TabsContent value="credits" className="flex flex-col gap-6">
          {credits}
        </TabsContent>
        <TabsContent value="wallet" className="flex flex-col gap-4">
          {wallet}
        </TabsContent>
      </Tabs>
    </SelectTabContext.Provider>
  );
}
