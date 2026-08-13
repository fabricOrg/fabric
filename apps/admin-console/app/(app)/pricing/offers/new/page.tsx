import type {
  CommercialOfferChannelDto,
  CommercialRouteVocabulary,
  PriceBookDto,
} from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Button } from "@app/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderBack,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ArrowLeft, Landmark } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewOfferForm } from "@/components/forms/new-offer-form";
import { requireAdminSession } from "@/lib/server/auth";
import { listCommercialOffers } from "@/lib/server/commercial-offers-client";
import { listPriceBooks } from "@/lib/server/price-book-client";

export default async function NewCommercialOfferPage() {
  const session = await requireAdminSession();
  if (!session.permissions.includes("staff:write")) notFound();

  let channels: CommercialOfferChannelDto[] = [];
  let routeVocabulary: CommercialRouteVocabulary = {};
  let catalogs: PriceBookDto[] = [];
  const [listed, books] = await Promise.all([
    listCommercialOffers(),
    listPriceBooks().then((result) => result.books),
  ]);
  channels = listed.channels.filter((channel) => channel.is_active);
  routeVocabulary = listed.route_vocabulary;
  catalogs = books.filter((book) => book.mode === "token");

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderBack asChild>
            <Link href="/pricing/offers">
              <ArrowLeft data-icon="inline-start" />
              Prepaid packages
            </Link>
          </PageHeaderBack>
          <PageHeaderTitle>New prepaid package</PageHeaderTitle>
          <PageHeaderDescription>
            Create the package and first draft version.
          </PageHeaderDescription>
        </PageHeaderHeading>
        <PageHeaderActions>
          <Button asChild variant="outline">
            <Link href="/pricing/offers">Cancel</Link>
          </Button>
        </PageHeaderActions>
      </PageHeader>

      {catalogs.length === 0 ? (
        <Empty className="rounded-lg border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Landmark />
            </EmptyMedia>
            <EmptyTitle>Create a token catalog first</EmptyTitle>
            <EmptyDescription>
              Prepaid packages need a token-mode price book before staff can
              author packages.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild variant="outline">
            <Link href="/pricing">Open pricing</Link>
          </Button>
        </Empty>
      ) : (
        <NewOfferForm
          catalogs={catalogs}
          channels={channels}
          routeVocabulary={routeVocabulary}
        />
      )}
    </PageContainer>
  );
}
