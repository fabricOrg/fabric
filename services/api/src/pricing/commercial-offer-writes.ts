import type {
  CommercialOfferDto,
  CommercialOfferEligibility as CommercialOfferEligibilityDto,
  CreateCommercialOfferVersionRequest,
} from "@app/contracts";
import {
  type MinorUnits,
  type PricingOffer,
  type PricingOfferVersion,
  type ProvisioningDb,
  priceBooks,
  pricingOffers,
  pricingOfferVersions,
  staffUsers,
} from "@app/db";
import { and, eq, ne } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";
import {
  toEligibilityDto,
  toOfferDto,
  toStoredEligibility,
} from "./commercial-offer-mapping.js";
import { readVersionContext } from "./commercial-offer-reads.js";

type Db = ProvisioningDb["db"];
/** A transaction shares the query surface these helpers use; `publish` calls them inside one. */
type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export const toOfferRowDto = (row: PricingOffer): CommercialOfferDto =>
  toOfferDto(row);

export async function readStaffEmailMap(
  db: Executor,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: staffUsers.id, email: staffUsers.email })
    .from(staffUsers);
  return new Map(rows.map((row) => [row.id, row.email]));
}

export async function loadOfferForWrite(
  db: Executor,
  offerId: string,
): Promise<PricingOffer> {
  const [offer] = await db
    .select()
    .from(pricingOffers)
    .where(eq(pricingOffers.id, offerId))
    .limit(1);
  if (!offer) throw notFound("offer_not_found", "Unknown commercial offer.");
  return offer;
}

export async function requireVersionContext(db: Db, versionId: string) {
  const context = await readVersionContext(db, versionId);
  if (!context) {
    throw notFound("offer_version_not_found", "Unknown offer version.");
  }
  return context;
}

/** The FK would reject an unknown staff id as a 500; this makes it an honest 400. */
export async function assertStaffExists(
  db: Executor,
  staffId: string,
): Promise<void> {
  const [staff] = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(eq(staffUsers.id, staffId))
    .limit(1);
  if (!staff) {
    throw invalidRequest(
      "staff_actor_unknown",
      "The acting staff member could not be resolved.",
    );
  }
}

/**
 * A prepaid offer lives in a TOKEN catalog. Migration 0117 enforces this with a trigger; this check
 * exists so staff get a sentence instead of a database exception.
 */
export async function assertTokenCatalog(
  db: Executor,
  priceBookId: string,
): Promise<void> {
  const [book] = await db
    .select({ mode: priceBooks.mode })
    .from(priceBooks)
    .where(eq(priceBooks.id, priceBookId))
    .limit(1);
  if (!book) throw notFound("price_book_not_found", "Unknown price book.");
  if (book.mode !== "token") {
    throw invalidRequest(
      "offer_catalog_invalid_mode",
      "Prepaid offers live in token-mode catalogs, not pay-as-you-go rate books.",
      "price_book_id",
    );
  }
}

export async function insertVersion(
  db: Executor,
  offerId: string,
  version: number,
  request: CreateCommercialOfferVersionRequest,
  createdBy: string,
): Promise<PricingOfferVersion> {
  const [row] = await db
    .insert(pricingOfferVersions)
    .values({
      offerId,
      version,
      status: "draft",
      currency: request.currency,
      paidUnits: BigInt(request.paid_units),
      bonusUnits: BigInt(request.bonus_units),
      totalUnits: BigInt(request.paid_units) + BigInt(request.bonus_units),
      totalPriceMinor: BigInt(request.total_price_minor) as MinorUnits,
      minimumPackCount: request.minimum_pack_count,
      maximumPackCount: request.maximum_pack_count,
      eligibility: toStoredEligibility(request.eligibility),
      effectiveFrom: new Date(request.effective_from),
      effectiveTo: request.effective_to ? new Date(request.effective_to) : null,
      createdBy,
    })
    .returning();
  if (!row) throw new Error("Offer version insert returned no row.");
  return row;
}

/**
 * Do these two reads of a version carry the SAME terms the margin gate judged?
 *
 * Publication evaluates the row as read, then updates only its lifecycle columns — so a draft edited
 * in between would be published carrying a cost snapshot that describes different terms, at a price no
 * gate approved. Comparing here rather than in a `WHERE` clause is deliberate: `updated_at` looks like
 * the obvious fingerprint but `timestamptz` keeps MICROSECONDS while the JavaScript `Date` read back is
 * millisecond-truncated, so `updated_at = $1` matches nothing and would reject every honest publish.
 */
export function offerTermsUnchanged(
  evaluated: PricingOfferVersion,
  current: PricingOfferVersion,
): boolean {
  return (
    current.currency === evaluated.currency &&
    current.totalUnits === evaluated.totalUnits &&
    current.paidUnits === evaluated.paidUnits &&
    current.bonusUnits === evaluated.bonusUnits &&
    current.totalPriceMinor === evaluated.totalPriceMinor &&
    current.minimumPackCount === evaluated.minimumPackCount &&
    current.maximumPackCount === evaluated.maximumPackCount &&
    current.effectiveFrom.getTime() === evaluated.effectiveFrom.getTime() &&
    (current.effectiveTo?.getTime() ?? null) ===
      (evaluated.effectiveTo?.getTime() ?? null) &&
    // Eligibility decides which routes were priced, so a change to it invalidates the verdict as surely
    // as a price change. Compared through the normalized DTO so key order cannot fake a difference.
    JSON.stringify(eligibilityOf(current)) ===
      JSON.stringify(eligibilityOf(evaluated))
  );
}

/** The version row as it stands now — read inside the publish transaction, under the offer's lock. */
export async function readVersionForUpdate(
  tx: Executor,
  versionId: string,
): Promise<PricingOfferVersion | null> {
  const [row] = await tx
    .select()
    .from(pricingOfferVersions)
    .where(eq(pricingOfferVersions.id, versionId))
    .limit(1);
  return row ?? null;
}

/** The eligibility of a stored version, in the wire shape the margin gate and preview both take. */
export function eligibilityOf(
  version: PricingOfferVersion,
): CommercialOfferEligibilityDto {
  return toEligibilityDto(version.eligibility);
}

/**
 * Two published versions of the same offer and currency must never be effective at once, or "the
 * current price" has two answers. Postgres cannot express this as a constraint without `btree_gist`
 * (an extension we do not require on managed Postgres), so the caller holds a row lock on the offer
 * while this runs — see `publish`.
 *
 * Windows are half-open: `[effective_from, effective_to)`, with a null end meaning open-ended.
 */
export async function assertNoOverlappingPublishedVersion(
  tx: Executor,
  candidate: PricingOfferVersion,
): Promise<void> {
  const rows = await tx
    .select({
      version: pricingOfferVersions.version,
      effectiveFrom: pricingOfferVersions.effectiveFrom,
      effectiveTo: pricingOfferVersions.effectiveTo,
    })
    .from(pricingOfferVersions)
    .where(
      and(
        eq(pricingOfferVersions.offerId, candidate.offerId),
        eq(pricingOfferVersions.currency, candidate.currency),
        eq(pricingOfferVersions.status, "published"),
        ne(pricingOfferVersions.id, candidate.id),
      ),
    );
  // Overlap is decided here rather than in SQL: an open-ended window is a null, and expressing
  // "null means forever" in a WHERE clause reads far worse than the two comparisons below.
  const candidateEnd = candidate.effectiveTo;
  const clash = rows.find((row) => {
    const startsBeforeExistingEnds =
      row.effectiveTo === null || candidate.effectiveFrom < row.effectiveTo;
    const endsAfterExistingStarts =
      candidateEnd === null || candidateEnd > row.effectiveFrom;
    return startsBeforeExistingEnds && endsAfterExistingStarts;
  });
  if (clash) {
    // NOT "close its window first": a published version is immutable except for status → retired
    // (0110's trigger), so its window can never be shortened. Retiring it is the only resolution, and
    // saying otherwise sends staff to look for a control that cannot exist.
    throw invalidRequest(
      "offer_version_window_conflict",
      `Version ${clash.version} is already effective for ${candidate.currency} over this period. Retire it, or start this version after it ends.`,
      "effective_from",
    );
  }
}
