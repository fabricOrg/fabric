import type {
  CommercialOfferChannelDto,
  CommercialOfferWithVersions,
  PriceBookDto,
} from "@app/contracts";
import { CommercialOffersManager } from "@/components/commercial-offers-manager";
import { requireAdminSession } from "@/lib/server/auth";
import { listCommercialOffers } from "@/lib/server/commercial-offers-client";
import { listPriceBooks } from "@/lib/server/price-book-client";

/**
 * Prepaid offers (ADR-0012) — kept on its own page rather than mixed into Pricing, because a
 * pay-as-you-go rate and a fixed-total bundle are different things: one prices a unit, the other is a
 * product with an immutable promise and an approval trail.
 */
export default async function CommercialOffersPage() {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");

  let offers: CommercialOfferWithVersions[] = [];
  let channels: CommercialOfferChannelDto[] = [];
  let catalogs: PriceBookDto[] = [];
  let loadError = false;
  try {
    const [listed, books] = await Promise.all([
      listCommercialOffers(),
      listPriceBooks().then((result) => result.books),
    ]);
    offers = listed.offers;
    channels = listed.channels;
    // Offers live in TOKEN-mode books; a subscription book is a rate plan, not a catalog.
    catalogs = books.filter((book) => book.mode === "token");
  } catch {
    // Any throw here means the catalog could not be loaded. Testing for specific error classes would
    // leave a non-Error throw rendering the success-shaped "No prepaid offers yet." empty state.
    loadError = true;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Prepaid offers
        </h1>
        <p className="text-sm text-muted-foreground">
          Fixed quantities for a fixed total price. A published version can
          never be edited — clone it to change terms. Publishing needs a second
          staff admin, active-channel evidence, and a margin above the catalog
          floor.
        </p>
      </div>

      {loadError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load prepaid offers right now. Try again shortly.
        </p>
      ) : (
        <CommercialOffersManager
          offers={offers}
          channels={channels}
          catalogs={catalogs}
          canManage={canManage}
          actorStaffId={session.userId}
        />
      )}
    </div>
  );
}
