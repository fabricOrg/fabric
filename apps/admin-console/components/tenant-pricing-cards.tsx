import type { PriceBookDto, TenantSummaryDto } from "@app/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { AccountPriceBookAssign } from "@/components/account-price-book-assign";
import { OfferCatalogAssign } from "@/components/offer-catalog-assign";

/**
 * The two commercial assignments a workspace carries: its pay-as-you-go rate plan and its prepaid
 * bundle catalog. Separate cards because they are separate decisions — one prices a unit as it is sent,
 * the other is the catalogue of bundles on offer — and extracted from the tenant page so that page does
 * not keep growing with each new commercial surface.
 *
 * `booksUnavailable` matters: without it a failed price-book fetch would render "Default" as though it
 * were a fact, on the one screen where negotiated pricing is decided. A name we could not resolve and a
 * workspace with no negotiated plan must not look identical.
 */
export function TenantPricingCards({
  tenant,
  books,
  booksUnavailable,
  canManage,
}: {
  tenant: TenantSummaryDto;
  books: readonly PriceBookDto[];
  booksUnavailable: boolean;
  canManage: boolean;
}) {
  const tokenCatalogs = books.filter((book) => book.mode === "token");
  const assignedBook = books.find((book) => book.id === tenant.price_book_id);
  const assignedCatalog = tokenCatalogs.find(
    (book) => book.id === tenant.offer_catalog_id,
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
          <CardDescription>
            The rate plan this tenant is billed against. Default resolves by
            mode. Changes are audited.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">
            Current:{" "}
            <span className="font-medium">
              {describe(
                booksUnavailable,
                tenant.price_book_id,
                assignedBook?.name,
                "Default (by mode)",
              )}
            </span>
          </span>
          {canManage && books.length > 0 ? (
            <AccountPriceBookAssign
              accountId={tenant.tenant_id}
              currentBookId={tenant.price_book_id}
              currentBillingCurrency={tenant.billing_currency}
              books={books}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prepaid catalog</CardTitle>
          <CardDescription>
            Which bundle catalogue this workspace can buy from. Separate from
            the rate plan above, and it affects future purchases only — a
            purchase snapshots the offer version it bought. Changes are audited.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">
            Current:{" "}
            <span className="font-medium">
              {describe(
                booksUnavailable,
                tenant.offer_catalog_id,
                assignedCatalog?.name,
                "Default prepaid catalog",
              )}
            </span>
          </span>
          {canManage && !booksUnavailable ? (
            <OfferCatalogAssign
              accountId={tenant.tenant_id}
              currentCatalogId={tenant.offer_catalog_id}
              catalogs={tokenCatalogs}
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Three genuinely different states, kept distinct: an assignment whose name we could not load, no
 * assignment at all, and a resolved name. Collapsing the first into the second is what turns a loading
 * failure into a false statement about a workspace's commercial terms.
 */
function describe(
  unavailable: boolean,
  assignedId: string | null,
  resolvedName: string | undefined,
  fallback: string,
): string {
  if (resolvedName) return resolvedName;
  if (assignedId) {
    return unavailable
      ? "Assigned — name unavailable right now"
      : `Assigned (${assignedId})`;
  }
  return unavailable ? "Unavailable right now" : fallback;
}
