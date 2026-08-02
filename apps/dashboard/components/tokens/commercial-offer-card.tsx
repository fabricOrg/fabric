"use client";

import {
  type CustomerCommercialOffer,
  parseApiError,
  purchaseCommercialOfferResponseSchema,
} from "@app/contracts";
import { BlueprintRuledFill } from "@app/ui/components/ui/blueprint";
import { Button } from "@app/ui/components/ui/button";
import { Card } from "@app/ui/components/ui/card";
import { QuantityStepper } from "@app/ui/components/ui/quantity-stepper";
import { cn } from "@app/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  Clock,
  Coins,
  Globe,
  Infinity as InfinityIcon,
  Mail,
  MessageSquare,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/lib/money";

const CHANNEL_ICON: Record<string, LucideIcon> = {
  sms: MessageSquare,
  email: Mail,
};

/**
 * A prepaid package, drawn as a technical spec sheet rather than a marketing card.
 *
 * Composition from the "Industrial pricing cards" design: a reference strip carrying the channel
 * glyphs, one ruled row per channel with the quantity set large against a small unit, terms as
 * bordered chips, then price / quantity / action.
 *
 * Type and colour are Fabric's own tokens on the standard Tailwind scale — the source design pulls
 * Barlow off Google Fonts and hard-codes px sizes, and this repo self-hosts its faces (white-label
 * + offline) and treats one-off sizes as design drift. The frame, stepper and marks come from
 * `@app/ui`, so this file describes the package and owns none of the widgets.
 *
 * Every number comes from the published offer version. The design's sample data included voice,
 * WhatsApp and push packs; those channels are not sold, so nothing here invents them.
 */
export function CommercialOfferCard({
  offer,
  index,
  canPurchase,
}: {
  readonly offer: CustomerCommercialOffer;
  /** Position in the catalog, used only for the "Pack 01" reference label. */
  readonly index: number;
  readonly canPurchase: boolean;
}) {
  const [packCount, setPackCount] = useState(offer.minimum_pack_count);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitPrice = BigInt(offer.total_price_minor);
  const total = formatMoney({
    currency: offer.currency,
    minor: (unitPrice * BigInt(packCount)).toString(),
  });
  const perPack = formatMoney({
    currency: offer.currency,
    minor: unitPrice.toString(),
  });
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
      window.location.assign(
        purchaseCommercialOfferResponseSchema.parse(payload).authorization_url,
      );
    } catch {
      setError("Checkout could not be started. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const reference = `Pack ${String(index + 1).padStart(2, "0")} / ${offer.offer_code}`;

  return (
    <Card className="gap-0 py-0">
      {/* Reference strip: what this pack is called in the catalog, and what it can send. */}
      <div className="flex items-center justify-between gap-3 border-b px-5 py-2.5">
        <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">
          {reference}
        </span>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {offer.items.map((item) => {
            const Icon = CHANNEL_ICON[item.channel_code] ?? Coins;
            return (
              <span
                key={item.channel_code}
                className="inline-flex size-6 items-center justify-center border bg-primary/10 text-primary"
              >
                <Icon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{item.channel_name}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-26 flex-col gap-1.5 border-b px-5 pt-4 pb-3.5">
        <h3 className="font-display font-semibold text-xl leading-tight tracking-tight">
          {offer.name}
        </h3>
        {offer.description ? (
          <p className="line-clamp-2 text-muted-foreground text-sm text-pretty">
            {offer.description}
          </p>
        ) : null}
      </div>

      {/* The spec table. One ruled row per channel; the fill continues the rhythm so packs with
          different channel counts still line their footers up across the grid. */}
      <div className="flex flex-1 flex-col">
        {offer.items.map((item) => {
          const Icon = CHANNEL_ICON[item.channel_code] ?? Coins;
          const quantity = BigInt(item.total_units) * BigInt(packCount);
          const bonus = BigInt(item.bonus_units) * BigInt(packCount);
          return (
            <div
              key={item.channel_code}
              className="flex h-12 items-center justify-between gap-3 border-foreground/10 border-b px-5"
            >
              <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
                <Icon className="size-3.5 text-primary" aria-hidden="true" />
                {item.channel_name}
                {bonus > 0n ? (
                  <span className="text-success normal-case tracking-normal">
                    +{bonus.toLocaleString("en")} free
                  </span>
                ) : null}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="font-display text-2xl leading-none tabular-nums tracking-tight">
                  {quantity.toLocaleString("en")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {item.unit_label}
                </span>
              </span>
            </div>
          );
        })}
        <BlueprintRuledFill />
      </div>

      <div className="flex min-h-14 flex-wrap content-start gap-1.5 border-y px-5 py-3.5">
        {describeTerms(offer).map((term) => (
          <span
            key={term.label}
            className={cn(
              "inline-flex items-center gap-1.5 border px-2.5 py-0.5 text-xs",
              term.tone === "warning"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "text-muted-foreground",
            )}
          >
            <term.icon
              className={cn(
                "size-3",
                term.tone === "warning" ? "text-warning" : "text-primary",
              )}
              aria-hidden="true"
            />
            {term.label}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col">
            <span className="font-display font-semibold text-3xl leading-none tabular-nums tracking-tight">
              {total}
            </span>
            <span className="mt-1 text-muted-foreground text-xs">
              {packCount > 1 ? `${packCount} × ${perPack}` : "per pack"}
            </span>
          </div>
          <QuantityStepper
            label="Number of packs"
            value={packCount}
            onChange={setPackCount}
            min={offer.minimum_pack_count}
            max={offer.maximum_pack_count}
            disabled={!canPurchase || submitting}
          />
        </div>

        {/* Corners come from Button itself now — the primary variant carries them by default. */}
        <Button
          className="w-full"
          size="lg"
          disabled={!canPurchase || submitting}
          onClick={purchase}
        >
          {submitting ? "Opening checkout…" : `Buy for ${total}`}
        </Button>

        {error ? (
          <p className="flex gap-2 text-destructive text-sm" role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <span className="text-center text-muted-foreground text-xs">
          {offer.purchased_packs > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3 text-success" aria-hidden="true" />
              Bought {offer.purchased_packs.toLocaleString("en")}× before
            </span>
          ) : (
            "Credits land as soon as payment clears"
          )}
        </span>
      </div>
    </Card>
  );
}

interface Term {
  icon: LucideIcon;
  label: string;
  /** `warning` marks the terms that cost you something if ignored — currently only expiry. */
  tone?: "warning";
}

/** Validity and eligibility, as the chips the terms row renders. */
function describeTerms(offer: CustomerCommercialOffer): Term[] {
  const terms: Term[] = [
    offer.credit_validity_days === null
      ? { icon: InfinityIcon, label: "Never expires" }
      : {
          icon: Clock,
          tone: "warning",
          label: `Expires in ${offer.credit_validity_days} ${
            offer.credit_validity_days === 1 ? "day" : "days"
          }`,
        },
  ];
  const restrictions = new Set<string>();
  for (const item of offer.items) {
    for (const country of item.eligibility.destination_countries) {
      restrictions.add(country);
    }
    for (const traffic of item.eligibility.traffic_classes) {
      restrictions.add(traffic);
    }
    for (const service of item.eligibility.service_classes) {
      restrictions.add(service);
    }
  }
  // Silence would read as "unknown", not "anywhere" — say which it is either way.
  terms.push({
    icon: Globe,
    label:
      restrictions.size === 0
        ? "No destination limits"
        : [...restrictions].join(" · "),
  });
  return terms;
}
