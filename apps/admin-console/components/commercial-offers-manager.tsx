"use client";

import type {
  CommercialOfferChannelDto,
  CommercialOfferVersionDto,
  CommercialOfferWithVersions,
  CommercialRouteVocabulary,
  Currency,
  PriceBookDto,
} from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { StatCard } from "@app/ui/components/ui/stat-card";
import { StatusBadge } from "@app/ui/components/ui/status-badge";
import { cn } from "@app/ui/lib/utils";
import {
  BadgeCheck,
  Boxes,
  CircleDollarSign,
  GitBranch,
  Landmark,
  PackagePlus,
  Plus,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { OfferTermsDialog } from "@/components/forms/offer-terms-dialog";
import { OfferVersionHistory } from "@/components/offer-version-history";
import { formatMoney } from "@/lib/money";

/**
 * The prepaid catalog, grouped by offer. Staff need both commerce shape (what can be sold) and
 * governance state (why it can or cannot publish), so the page leads with catalog health before the
 * version history.
 */
export function CommercialOffersManager({
  offers,
  channels,
  routeVocabulary,
  selfApprovalAllowed,
  catalogs,
  canManage,
  actorStaffId,
}: {
  offers: readonly CommercialOfferWithVersions[];
  channels: readonly CommercialOfferChannelDto[];
  routeVocabulary: CommercialRouteVocabulary;
  selfApprovalAllowed: boolean;
  catalogs: readonly PriceBookDto[];
  canManage: boolean;
  actorStaffId: string;
}) {
  const [draftingFor, setDraftingFor] =
    useState<CommercialOfferWithVersions | null>(null);
  const activeChannels = channels.filter((channel) => channel.is_active);
  const versions = offers.flatMap((offer) => offer.versions);
  const published = versions.filter(
    (version) => version.status === "published",
  );
  const drafts = versions.filter((version) => version.status === "draft");

  if (catalogs.length === 0) {
    return <MissingCatalogState />;
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Packages" value={offers.length} icon={Boxes} />
        <StatCard
          label="Published"
          value={published.length}
          icon={BadgeCheck}
          iconClassName="bg-success/10 text-success"
        />
        <StatCard
          label="Drafts"
          value={drafts.length}
          icon={GitBranch}
          iconClassName="bg-primary/10 text-primary"
        />
        <StatCard
          label="Active channels"
          value={activeChannels.length}
          icon={ShieldCheck}
          iconClassName="bg-warning/10 text-warning-strong"
        />
      </div>

      {offers.length === 0 ? (
        <EmptyCatalogState canManage={canManage} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="font-medium text-sm">Package catalog</h2>
            </div>
            {canManage ? (
              <Button asChild size="sm">
                <Link href="/pricing/offers/new">
                  <Plus data-icon="inline-start" />
                  New package
                </Link>
              </Button>
            ) : null}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                canManage={canManage}
                actorStaffId={actorStaffId}
                channels={activeChannels}
                routeVocabulary={routeVocabulary}
                selfApprovalAllowed={selfApprovalAllowed}
                onNewVersion={() => setDraftingFor(offer)}
              />
            ))}
          </div>
        </div>
      )}

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

function MissingCatalogState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-4 text-primary" />
          Create a token catalog first
        </CardTitle>
        <CardDescription>
          Prepaid packages need a token-mode price book.
        </CardDescription>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/pricing">Open pricing</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <CatalogStep
          title="Create token book"
          description="Create a token-mode price book."
        />
        <CatalogStep
          title="Add package"
          description="Set credits, price, and limits."
        />
        <CatalogStep
          title="Publish by review"
          description="Publish after approval."
        />
      </CardContent>
    </Card>
  );
}

function EmptyCatalogState({ canManage }: { canManage: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackagePlus className="size-4 text-primary" />
          Design the first package
        </CardTitle>
        <CardDescription>
          Bundle credits into a fixed-price product.
        </CardDescription>
        {canManage ? (
          <CardAction>
            <Button asChild size="sm">
              <Link href="/pricing/offers/new">
                <Plus data-icon="inline-start" />
                New package
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <CatalogStep
          title="Name the product"
          description="Add name and code."
        />
        <CatalogStep
          title="Set the terms"
          description="Set credits and price."
        />
        <CatalogStep
          title="Capture evidence"
          description="Submit for review."
        />
      </CardContent>
    </Card>
  );
}

function CatalogStep({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border bg-muted/20 p-4">
      <span className="font-medium text-sm">{title}</span>
      <span className="text-muted-foreground text-sm">{description}</span>
    </div>
  );
}

function OfferCard({
  offer,
  canManage,
  actorStaffId,
  channels,
  routeVocabulary,
  selfApprovalAllowed,
  onNewVersion,
}: {
  offer: CommercialOfferWithVersions;
  canManage: boolean;
  actorStaffId: string;
  channels: readonly CommercialOfferChannelDto[];
  routeVocabulary: CommercialRouteVocabulary;
  selfApprovalAllowed: boolean;
  onNewVersion: () => void;
}) {
  const latest = offer.versions[0] ?? null;
  const published = offer.versions.find(
    (version) => version.status === "published",
  );
  const status = latest?.status ?? "empty";
  const units = latest ? summarizeUnits(latest) : "No terms";
  const catalogName = readableCatalogName(offer.catalog_name);

  return (
    <Card
      className={cn(
        "transition-colors hover:bg-muted/10",
        status === "published" && "border-l-success",
        status === "draft" && "border-l-primary",
        status === "retired" && "border-l-muted-foreground",
      )}
    >
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-col gap-2 text-base">
          <span className="truncate">{offer.name}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              {offer.code}
            </Badge>
            <span className="text-muted-foreground text-xs">{catalogName}</span>
          </span>
        </CardTitle>
        <CardAction>
          <OfferLifecycleBadge status={status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {offer.description ? (
          <p className="text-muted-foreground text-sm">{offer.description}</p>
        ) : null}

        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
          <OfferMetric
            label={latest ? `v${latest.version} price` : "Price"}
            value={
              latest
                ? formatMoney({
                    currency: latest.currency as Currency,
                    minor: latest.total_price_minor,
                  })
                : "-"
            }
            icon={<CircleDollarSign />}
          />
          <OfferMetric label="Included" value={units} icon={<Boxes />} />
          <OfferMetric
            label="Live version"
            value={published ? `v${published.version}` : "None"}
            icon={<BadgeCheck />}
          />
        </div>

        <OfferVersionHistory
          offer={offer}
          canManage={canManage}
          actorStaffId={actorStaffId}
          channels={channels}
          routeVocabulary={routeVocabulary}
          selfApprovalAllowed={selfApprovalAllowed}
        />

        {canManage ? (
          <div>
            <Button size="sm" variant="outline" onClick={onNewVersion}>
              New version
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OfferLifecycleBadge({ status }: { status: string }) {
  if (status === "published") {
    return <StatusBadge tone="success" label="Published" />;
  }
  if (status === "retired") {
    return <StatusBadge tone="neutral" label="Retired" />;
  }
  if (status === "draft") {
    return <StatusBadge tone="info" label="Draft" />;
  }
  return <StatusBadge tone="warning" label="Needs terms" />;
}

function readableCatalogName(name: string): string {
  return name.replace(
    /\s+[-\u2014]\s+[0-9a-f]{8}-[0-9a-f-]{27,}$/i,
    " catalog",
  );
}

function summarizeUnits(version: CommercialOfferVersionDto): string {
  return version.items
    .map((item) => `${item.total_units} ${item.unit_code}s`)
    .join(" + ");
}

function OfferMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md bg-muted/25 px-3 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center border bg-background text-primary [&_svg]:size-3.5">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-[10px] text-muted-foreground uppercase">
          {label}
        </span>
        <span className="font-medium text-sm leading-tight">{value}</span>
      </span>
    </div>
  );
}
