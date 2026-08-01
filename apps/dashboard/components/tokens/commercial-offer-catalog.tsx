"use client";

import {
  type CustomerCommercialOffer,
  type CustomerCommercialOfferCatalog,
  parseApiError,
  purchaseCommercialOfferResponseSchema,
  type TokenBalancesResponse,
} from "@app/contracts";
import { Alert, AlertDescription } from "@app/ui/components/ui/alert";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Input } from "@app/ui/components/ui/input";
import { Coins, LockKeyhole, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/lib/money";

interface CommercialOfferCatalogProps {
  readonly catalog: CustomerCommercialOfferCatalog;
  readonly balances: TokenBalancesResponse["balances"];
  readonly canPurchase: boolean;
}

export function CommercialOfferCatalog({
  catalog,
  balances,
  canPurchase,
}: CommercialOfferCatalogProps) {
  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="token-packs-title"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="token-packs-title" className="text-lg font-semibold">
            {catalog.catalog_name}
          </h2>
          <p className="text-sm text-muted-foreground">
            Prepay for channel units. Eligibility is locked into each purchase
            and checked when a send reserves tokens.
          </p>
        </div>
        {balances.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Token balances"
          >
            {balances.map((balance) => (
              <Badge
                key={`${balance.channel}:${balance.currency}`}
                variant="secondary"
                className="font-mono tabular-nums"
              >
                <Coins aria-hidden="true" />
                {BigInt(balance.available).toLocaleString("en")}{" "}
                {balance.channel}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No offers available</CardTitle>
            <CardDescription>
              There is no published offer in this workspace&apos;s billing
              currency right now.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {catalog.offers.map((offer) => (
            <OfferCard
              key={offer.offer_version_id}
              offer={offer}
              canPurchase={canPurchase}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function OfferCard({
  offer,
  canPurchase,
}: {
  readonly offer: CustomerCommercialOffer;
  readonly canPurchase: boolean;
}) {
  const [packCount, setPackCount] = useState(offer.minimum_pack_count);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalUnits = BigInt(offer.total_units) * BigInt(packCount);
  const totalPrice = BigInt(offer.total_price_minor) * BigInt(packCount);
  let bonusDescription = "";
  if (BigInt(offer.bonus_units) > 0n) {
    const bonus = BigInt(offer.bonus_units) * BigInt(packCount);
    bonusDescription = ` (${bonus.toLocaleString("en")} bonus)`;
  }

  async function purchase() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard/tokens/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offer_version_id: offer.offer_version_id,
          pack_count: packCount,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(parseApiError(payload).message);
        return;
      }
      const purchase = purchaseCommercialOfferResponseSchema.parse(payload);
      window.location.assign(purchase.authorization_url);
    } catch {
      setError("Checkout could not be started. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const eligibility = describeEligibility(offer);
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline">{offer.channel_name}</Badge>
          <span className="text-xs text-muted-foreground">
            per {offer.unit_label}
          </span>
        </div>
        <CardTitle>{offer.name}</CardTitle>
        <CardDescription>{offer.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div>
          <p className="font-display text-2xl font-semibold tabular-nums">
            {formatMoney({
              currency: offer.currency,
              minor: totalPrice.toString(),
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {totalUnits.toLocaleString("en")} {offer.unit_label}
            {bonusDescription}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {eligibility.map((item) => (
            <Badge key={item} variant="secondary">
              {item}
            </Badge>
          ))}
        </div>
        <label
          className="grid gap-1 text-sm"
          htmlFor={`packs-${offer.offer_version_id}`}
        >
          Number of packs
          <Input
            id={`packs-${offer.offer_version_id}`}
            type="number"
            inputMode="numeric"
            min={offer.minimum_pack_count}
            max={offer.maximum_pack_count ?? undefined}
            value={packCount}
            disabled={!canPurchase || submitting}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isSafeInteger(next) && next > 0) setPackCount(next);
            }}
          />
        </label>
        {error ? (
          <p className="flex gap-2 text-sm text-destructive" role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          disabled={!canPurchase || submitting}
          onClick={purchase}
        >
          {submitting ? "Opening checkout..." : "Buy token pack"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function describeEligibility(offer: CustomerCommercialOffer): string[] {
  const labels: string[] = [];
  if (offer.eligibility.destination_countries.length > 0) {
    labels.push(offer.eligibility.destination_countries.join(", "));
  }
  if (offer.eligibility.traffic_classes.length > 0) {
    labels.push(offer.eligibility.traffic_classes.join(", "));
  }
  if (offer.eligibility.service_classes.length > 0) {
    labels.push(offer.eligibility.service_classes.join(", "));
  }
  if (labels.length === 0) labels.push("Standard eligibility");
  return labels;
}
