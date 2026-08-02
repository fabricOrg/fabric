"use client";

import { ArrowLeft } from "lucide-react";
import { type ReactNode, useState } from "react";

type CreditsView = "buy" | "history";

/**
 * Buying and past purchases are the same question at two moments — "what can I get" and "what did I
 * get" — so they share a tab and swap in place. Stacking them would push history below however many
 * packages the catalog happens to hold; swapping keeps both one click away at a fixed position.
 *
 * The switch is a rule-anchored link rather than a second segmented control: there are only two
 * states, one is clearly primary, and another segmented widget directly under the page's tab strip
 * would read as a second set of tabs.
 */
export function CreditsPanel({
  catalog,
  history,
  purchaseCount,
}: {
  catalog: ReactNode;
  history: ReactNode;
  /** Shown on the control so a purchase is visibly there before you click. */
  purchaseCount: number;
}) {
  const [view, setView] = useState<CreditsView>("buy");
  const buying = view === "buy";

  return (
    <section className="flex flex-col gap-6 border-t pt-6">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-display font-semibold text-2xl leading-tight tracking-tight">
            {buying ? "Buy packages" : "Purchase history"}
          </h2>
          <p className="max-w-[62ch] text-muted-foreground text-sm">
            {buying
              ? "Prepay for channel units. Eligibility is locked into each purchase and checked when a send reserves tokens."
              : "Every package payment and the credits it granted. Packages are charged to your card, never to your wallet balance."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setView(buying ? "history" : "buy")}
          className="inline-flex items-center gap-1.5 border-current border-b pb-0.5 text-primary text-xs transition-colors hover:text-primary/80"
        >
          {buying ? (
            <>
              Purchase history
              {purchaseCount > 0 ? ` (${purchaseCount})` : null}
            </>
          ) : (
            <>
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Buy packages
            </>
          )}
        </button>
      </div>
      {buying ? catalog : history}
    </section>
  );
}
