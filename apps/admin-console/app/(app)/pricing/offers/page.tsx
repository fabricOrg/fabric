import type {
  CommercialOfferChannelDto,
  CommercialOfferWithVersions,
  CommercialRouteVocabulary,
  PriceBookDto,
} from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";
import { CommercialOffersManager } from "@/components/commercial-offers-manager";
import { requireAdminSession } from "@/lib/server/auth";
import { listCommercialOffers } from "@/lib/server/commercial-offers-client";
import { listPriceBooks } from "@/lib/server/price-book-client";

/**
 * Prepaid packages (ADR-0012) stay apart from unit Pricing: a pay-as-you-go rate prices one send,
 * while a package is a purchasable promise with immutable terms and an approval trail.
 */
export default async function CommercialOffersPage() {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");

  let offers: CommercialOfferWithVersions[] = [];
  let channels: CommercialOfferChannelDto[] = [];
  let routeVocabulary: CommercialRouteVocabulary = {};
  let selfApprovalAllowed = false;
  let catalogs: PriceBookDto[] = [];
  let loadError = false;
  try {
    const [listed, books] = await Promise.all([
      listCommercialOffers(),
      listPriceBooks().then((result) => result.books),
    ]);
    offers = listed.offers;
    channels = listed.channels;
    routeVocabulary = listed.route_vocabulary;
    selfApprovalAllowed = listed.self_approval_allowed;
    // Offers live in TOKEN-mode books; a subscription book is a rate plan, not a catalog.
    catalogs = books.filter((book) => book.mode === "token");
  } catch {
    // Any throw here means the catalog could not be loaded. Testing for specific error classes would
    // leave a non-Error throw rendering the success-shaped empty state.
    loadError = true;
  }

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Prepaid packages</PageHeaderTitle>
          <PageHeaderDescription>
            Fixed-credit bundles with immutable published versions and staff
            approval.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      {loadError ? (
        <ErrorState
          title="Couldn't load prepaid packages"
          message="The package catalog is temporarily unavailable. Try again shortly."
        />
      ) : (
        <CommercialOffersManager
          offers={offers}
          channels={channels}
          routeVocabulary={routeVocabulary}
          selfApprovalAllowed={selfApprovalAllowed}
          catalogs={catalogs}
          canManage={canManage}
          actorStaffId={session.userId}
        />
      )}
    </PageContainer>
  );
}
