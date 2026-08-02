"use client";

import {
  type CustomerCommercialOffer,
  type CustomerCommercialOfferCatalog,
  parseApiError,
  purchaseCommercialOfferResponseSchema,
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
import { cn } from "@app/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  Clock,
  Coins,
  Infinity as InfinityIcon,
  LockKeyhole,
  Mail,
  MessageSquare,
  Minus,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/lib/money";

const CHANNEL_ICON: Record<string, LucideIcon> = {
  sms: MessageSquare,
  email: Mail,
};

interface CommercialOfferCatalogProps {
  readonly catalog: CustomerCommercialOfferCatalog;
  readonly canPurchase: boolean;
}

export function CommercialOfferCatalog({
  catalog,
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
  const unitPrice = BigInt(offer.total_price_minor);
  const totalPrice = unitPrice * BigInt(packCount);
  const expires = offer.credit_validity_days !== null;
  const min = offer.minimum_pack_count;
  const max = offer.maximum_pack_count;

  function clamp(next: number): number {
    if (!Number.isSafeInteger(next)) return packCount;
    if (next < min) return min;
    if (max !== null && next > max) return max;
    return next;
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
  const total = formatMoney({
    currency: offer.currency,
    minor: totalPrice.toString(),
  });
  // A per-unit rate is only honest for a single-channel pack. Splitting one price across emails AND
  // segments would require a cost allocation the customer never agreed to, so mixed packs show none.
  const soleItem = offer.items.length === 1 ? offer.items[0] : undefined;
  const perUnit =
    soleItem && BigInt(soleItem.total_units) > 0n
      ? formatMoney({
          currency: offer.currency,
          minor: (unitPrice / BigInt(soleItem.total_units)).toString(),
        })
      : null;

  return (
    // The accent edge matches the credit tiles: an expiring package and the expiring balance it
    // produces are the same fact seen before and after purchase.
    <Card
      className={cn(
        "group relative flex flex-col gap-0 overflow-hidden border-l-2 py-0 transition-shadow hover:shadow-md",
        expires ? "border-l-warning/50" : "border-l-primary/50",
      )}
    >
      <CardHeader
        className={cn(
          "gap-2 border-b bg-gradient-to-br px-5 py-4",
          expires
            ? "from-warning/8 to-transparent"
            : "from-primary/8 to-transparent",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {offer.items.map((item) => {
              const Icon = CHANNEL_ICON[item.channel_code] ?? Coins;
              return (
                <Badge
                  key={item.channel_code}
                  variant="outline"
                  className="gap-1 bg-background/60"
                >
                  <Icon className="size-3" aria-hidden="true" />
                  {item.channel_name}
                </Badge>
              );
            })}
          </div>
          {offer.purchased_packs > 0 ? (
            <Badge
              variant="outline"
              className="shrink-0 gap-1 border-transparent bg-success/12 text-success"
            >
              <Check className="size-3" aria-hidden="true" />
              Bought {offer.purchased_packs.toLocaleString("en")}×
            </Badge>
          ) : null}
        </div>
        <CardTitle className="text-lg">{offer.name}</CardTitle>
        {offer.description ? (
          <CardDescription>{offer.description}</CardDescription>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 px-5 py-4">
        {/* What you get, before what it costs — the quantity is the reason to buy. */}
        <ul className="grid gap-2">
          {offer.items.map((item) => {
            const Icon = CHANNEL_ICON[item.channel_code] ?? Coins;
            const quantity = BigInt(item.total_units) * BigInt(packCount);
            const bonus = BigInt(item.bonus_units) * BigInt(packCount);
            return (
              <li
                key={item.channel_code}
                className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-sm">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="font-display font-semibold text-xl tabular-nums leading-none">
                  {quantity.toLocaleString("en")}
                </span>
                <span className="text-muted-foreground text-sm">
                  {quantity === 1n ? item.unit_label : `${item.unit_label}s`}
                </span>
                {bonus > 0n ? (
                  <Badge
                    variant="outline"
                    className="ml-auto border-transparent bg-success/12 text-success text-xs"
                  >
                    +{bonus.toLocaleString("en")} free
                  </Badge>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "gap-1 border-transparent",
              expires
                ? "bg-warning/12 text-warning"
                : "bg-muted text-muted-foreground",
            )}
          >
            {expires ? (
              <>
                <Clock className="size-3" aria-hidden="true" />
                Expires in {offer.credit_validity_days}{" "}
                {offer.credit_validity_days === 1 ? "day" : "days"}
              </>
            ) : (
              <>
                <InfinityIcon className="size-3" aria-hidden="true" />
                Never expires
              </>
            )}
          </Badge>
          {eligibility.map((item) => (
            <Badge key={item} variant="secondary">
              {item}
            </Badge>
          ))}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 border-t pt-4">
          <div className="flex flex-col">
            <span className="font-display font-semibold text-3xl tabular-nums leading-none">
              {total}
            </span>
            <span className="mt-1.5 text-muted-foreground text-xs tabular-nums">
              {packCount > 1
                ? `${packCount} packs × ${formatMoney({
                    currency: offer.currency,
                    minor: unitPrice.toString(),
                  })}`
                : perUnit
                  ? `≈ ${perUnit} per ${soleItem?.unit_label}`
                  : "per pack"}
            </span>
          </div>
          <div
            className="flex items-center rounded-md border bg-background"
            role="group"
            aria-label="Number of packs"
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 rounded-r-none"
              disabled={!canPurchase || submitting || packCount <= min}
              aria-label="One pack fewer"
              onClick={() => setPackCount(clamp(packCount - 1))}
            >
              <Minus />
            </Button>
            <Input
              id={`packs-${offer.offer_version_id}`}
              type="number"
              inputMode="numeric"
              aria-label="Number of packs"
              min={min}
              max={max ?? undefined}
              value={packCount}
              disabled={!canPurchase || submitting}
              onChange={(event) =>
                setPackCount(clamp(event.currentTarget.valueAsNumber))
              }
              className="h-8 w-12 rounded-none border-0 px-0 text-center tabular-nums shadow-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 rounded-l-none"
              disabled={
                !canPurchase || submitting || (max !== null && packCount >= max)
              }
              aria-label="One pack more"
              onClick={() => setPackCount(clamp(packCount + 1))}
            >
              <Plus />
            </Button>
          </div>
        </div>

        {error ? (
          <p className="flex gap-2 text-sm text-destructive" role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="px-5 pb-5">
        <Button
          className="w-full"
          disabled={!canPurchase || submitting}
          onClick={purchase}
        >
          {submitting ? "Opening checkout…" : `Buy for ${total}`}
        </Button>
      </CardFooter>
    </Card>
  );
}

function describeEligibility(offer: CustomerCommercialOffer): string[] {
  const labels: string[] = [];
  for (const item of offer.items) {
    const eligibility = item.eligibility;
    if (eligibility.destination_countries.length > 0) {
      labels.push(
        `${item.channel_name}: ${eligibility.destination_countries.join(", ")}`,
      );
    }
    if (eligibility.traffic_classes.length > 0) {
      labels.push(
        `${item.channel_name}: ${eligibility.traffic_classes.join(", ")}`,
      );
    }
    if (eligibility.service_classes.length > 0) {
      labels.push(
        `${item.channel_name}: ${eligibility.service_classes.join(", ")}`,
      );
    }
  }
  // No restriction is worth saying out loud — silence reads as "unknown", not "anywhere".
  if (labels.length === 0) labels.push("No destination limits");
  return labels;
}
