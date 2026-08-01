"use client";

import type {
  CommercialOfferChannelDto,
  CommercialOfferWithVersions,
  CommercialRouteVocabulary,
  PriceBookDto,
} from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Plus } from "lucide-react";
import { useState } from "react";
import { NewOfferDialog } from "@/components/forms/new-offer-dialog";
import { OfferTermsDialog } from "@/components/forms/offer-terms-dialog";
import { OfferVersionHistory } from "@/components/offer-version-history";

/**
 * The prepaid catalog, grouped by the offer it belongs to. Each offer shows its whole version history
 * rather than only what is live: "what did we sell in June" is the question this page exists to answer
 * once a customer disputes a bundle.
 */
export function CommercialOffersManager({
  offers,
  channels,
  routeVocabulary,
  catalogs,
  canManage,
  actorStaffId,
}: {
  offers: readonly CommercialOfferWithVersions[];
  channels: readonly CommercialOfferChannelDto[];
  routeVocabulary: CommercialRouteVocabulary;
  catalogs: readonly PriceBookDto[];
  canManage: boolean;
  actorStaffId: string;
}) {
  const [creating, setCreating] = useState(false);
  const [draftingFor, setDraftingFor] =
    useState<CommercialOfferWithVersions | null>(null);
  const activeChannels = channels.filter((channel) => channel.is_active);

  if (catalogs.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Prepaid packages live in a token-mode price book. Create one on{" "}
        <span className="font-medium">Pricing</span> first — assigning a
        subscription (pay-as-you-go) rate book as a catalog is refused, because
        nothing in it could be purchased.
      </p>
    );
  }

  return (
    <>
      {canManage ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New offer
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {offers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No prepaid packages yet.
          </p>
        ) : null}

        {offers.map((offer) => (
          <Card key={offer.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {offer.name}
                <Badge variant="outline" className="font-mono text-[10px]">
                  {offer.code}
                </Badge>
              </CardTitle>
              <CardDescription>
                {offer.catalog_name}
                {offer.description ? ` — ${offer.description}` : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <OfferVersionHistory
                offer={offer}
                canManage={canManage}
                actorStaffId={actorStaffId}
                channels={activeChannels}
                routeVocabulary={routeVocabulary}
              />
              {canManage ? (
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDraftingFor(offer)}
                  >
                    Add draft terms
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <NewOfferDialog
        open={creating}
        onOpenChange={setCreating}
        catalogs={catalogs}
        channels={activeChannels}
        routeVocabulary={routeVocabulary}
      />
      {draftingFor ? (
        <OfferTermsDialog
          offer={draftingFor}
          version={null}
          channels={activeChannels}
          routeVocabulary={routeVocabulary}
          open={draftingFor !== null}
          onOpenChange={(open) => {
            if (!open) setDraftingFor(null);
          }}
        />
      ) : null}
    </>
  );
}
