"use client";

import type { CustomerCommercialOfferCatalog } from "@app/contracts";
import { Alert, AlertDescription } from "@app/ui/components/ui/alert";
import { EmptyState } from "@app/ui/components/ui/states";
import { Coins, LockKeyhole } from "lucide-react";
import { CommercialOfferCard } from "./commercial-offer-card";

interface CommercialOfferCatalogProps {
  readonly catalog: CustomerCommercialOfferCatalog;
  readonly canPurchase: boolean;
}

/**
 * The prepaid catalog grid. The section heading belongs to `CreditsPanel`, which owns the
 * buy / history switch — repeating it here would print two titles for one section.
 *
 * `auto-fit` with a 320px floor rather than a fixed column count: each card is a spec table whose
 * rows must stay readable, so the grid drops to fewer columns instead of squeezing them. The gap is
 * wide because each Card's registration marks are drawn outside its border.
 */
export function CommercialOfferCatalog({
  catalog,
  canPurchase,
}: CommercialOfferCatalogProps) {
  return (
    <div className="flex flex-col gap-5">
      {!canPurchase ? (
        <Alert>
          <LockKeyhole />
          <AlertDescription>
            You can inspect prices and token balances. Only workspace owners and
            admins can start a purchase.
          </AlertDescription>
        </Alert>
      ) : null}

      {catalog.offers.length === 0 ? (
        <EmptyState
          icon={<Coins />}
          title="No packages available"
          description="There is no published package in this workspace's billing currency right now."
        />
      ) : (
        <div className="grid items-stretch gap-8 [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]">
          {catalog.offers.map((offer, index) => (
            <CommercialOfferCard
              key={offer.offer_version_id}
              offer={offer}
              index={index}
              canPurchase={canPurchase}
            />
          ))}
        </div>
      )}
    </div>
  );
}
