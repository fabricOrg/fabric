"use client";

import { Button } from "@app/ui/components/ui/button";
import { cn } from "@app/ui/lib/utils";
import { type ReactNode, useState } from "react";

type CreditsView = "buy" | "history";

/**
 * Buying and past purchases are the same question at two moments — "what can I get" and "what did I
 * get" — so they share a tab and swap in place. Stacking them would push history below however many
 * packages the catalog happens to hold; a switch keeps both one click away at a fixed position.
 *
 * The credit balances stay ABOVE this switch on purpose: they are the answer to "what do I hold
 * right now", which is true in either view.
 */
export function CreditsPanel({
  catalog,
  history,
  purchaseCount,
}: {
  catalog: ReactNode;
  history: ReactNode;
  /** Shown on the History control so a purchase is visibly there before you click. */
  purchaseCount: number;
}) {
  const [view, setView] = useState<CreditsView>("buy");

  return (
    <section className="flex flex-col gap-4">
      <div
        className="inline-flex w-fit rounded-md border p-0.5"
        role="group"
        aria-label="Credits view"
      >
        {(
          [
            { value: "buy", label: "Buy packages" },
            {
              value: "history",
              label:
                purchaseCount > 0
                  ? `Purchase history (${purchaseCount})`
                  : "Purchase history",
            },
          ] as const
        ).map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={view === option.value}
            onClick={() => setView(option.value)}
            className={cn(
              "h-7 px-3 text-xs",
              view === option.value && "bg-muted text-foreground",
            )}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {view === "buy" ? catalog : history}
    </section>
  );
}
