import type {
  CommercialOfferChannelDto,
  CommercialOfferWithVersions,
  Currency,
} from "@app/contracts";
import {
  commercialOfferChannels,
  offerCatalogAssignments,
  type ProvisioningDb,
  priceBooks,
  priceBookVersions,
  pricingOffers,
  pricingOfferVersions,
  providerCostRates,
  staffUsers,
  type TenantId,
} from "@app/db";
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { CostRateRow } from "./commercial-offer-cost.js";
import { toOfferDto, toVersionDto } from "./commercial-offer-mapping.js";

type Db = ProvisioningDb["db"];

/** Applied when a catalog predates price-book versioning; recorded in the snapshot as such. */
export const PLATFORM_DEFAULT_MARGIN_BPS = 2_000;

export interface MarginFloor {
  readonly bps: number;
  readonly source: "catalog_version" | "platform_default";
}

export async function listChannelRegistry(
  db: Db,
): Promise<CommercialOfferChannelDto[]> {
  const rows = await db
    .select()
    .from(commercialOfferChannels)
    .orderBy(
      asc(commercialOfferChannels.code),
      asc(commercialOfferChannels.unitCode),
    );
  return rows.map((row) => ({
    code: row.code,
    unit_code: row.unitCode,
    display_name: row.displayName,
    unit_label: row.unitLabel,
    is_active: row.isActive,
  }));
}

/**
 * Every offer with its full version history, newest version first — the admin authoring surface needs
 * the history, and there are few enough offers per catalog that paginating it would cost more clarity
 * than it saves.
 */
export async function listOffersWithVersions(
  db: Db,
): Promise<CommercialOfferWithVersions[]> {
  const offers = await db
    .select({ offer: pricingOffers, catalogName: priceBooks.name })
    .from(pricingOffers)
    .innerJoin(priceBooks, eq(priceBooks.id, pricingOffers.priceBookId))
    .orderBy(asc(priceBooks.name), asc(pricingOffers.code));
  if (offers.length === 0) return [];

  const versions = await db
    .select()
    .from(pricingOfferVersions)
    .orderBy(desc(pricingOfferVersions.version));
  const staffEmails = await readStaffEmails(db);

  return offers.map(({ offer, catalogName }) => ({
    ...toOfferDto(offer),
    catalog_name: catalogName,
    versions: versions
      .filter((version) => version.offerId === offer.id)
      .map((version) => toVersionDto(version, staffEmails)),
  }));
}

async function readStaffEmails(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: staffUsers.id, email: staffUsers.email })
    .from(staffUsers);
  return new Map(rows.map((row) => [row.id, row.email]));
}

export interface OfferVersionContext {
  readonly version: typeof pricingOfferVersions.$inferSelect;
  readonly offer: typeof pricingOffers.$inferSelect;
  readonly catalogName: string;
}

export async function readVersionContext(
  db: Db,
  versionId: string,
): Promise<OfferVersionContext | null> {
  const [row] = await db
    .select({
      version: pricingOfferVersions,
      offer: pricingOffers,
      catalogName: priceBooks.name,
    })
    .from(pricingOfferVersions)
    .innerJoin(
      pricingOffers,
      eq(pricingOffers.id, pricingOfferVersions.offerId),
    )
    .innerJoin(priceBooks, eq(priceBooks.id, pricingOffers.priceBookId))
    .where(eq(pricingOfferVersions.id, versionId))
    .limit(1);
  return row ?? null;
}

/**
 * The registry entry for a channel + unit pair, or null when the pair is not registered at all. The
 * caller decides which question it is asking: authoring needs REGISTERED, publication needs ACTIVE
 * (ADR-0012 §2 — a registry entry is not proof of deliverability).
 */
export async function readChannel(
  db: Db,
  channelCode: string,
  unitCode: string,
): Promise<{ isActive: boolean } | null> {
  const [row] = await db
    .select({ isActive: commercialOfferChannels.isActive })
    .from(commercialOfferChannels)
    .where(
      and(
        eq(commercialOfferChannels.code, channelCode),
        eq(commercialOfferChannels.unitCode, unitCode),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The catalog's margin floor. A token catalog created before price-book versioning has no published
 * version; rather than skip the gate, fall back to the platform default the pay-as-you-go path
 * already uses and RECORD which source applied, so the evidence never overstates its provenance.
 */
export async function readMarginFloor(
  db: Db,
  priceBookId: string,
): Promise<MarginFloor> {
  const [version] = await db
    .select({ minimumMarginBps: priceBookVersions.minimumMarginBps })
    .from(priceBookVersions)
    .where(
      and(
        eq(priceBookVersions.priceBookId, priceBookId),
        eq(priceBookVersions.status, "published"),
        lte(priceBookVersions.effectiveFrom, sql`now()`),
        or(
          isNull(priceBookVersions.effectiveTo),
          gt(priceBookVersions.effectiveTo, sql`now()`),
        ),
      ),
    )
    .orderBy(desc(priceBookVersions.version))
    .limit(1);
  return version
    ? { bps: version.minimumMarginBps, source: "catalog_version" }
    : { bps: PLATFORM_DEFAULT_MARGIN_BPS, source: "platform_default" };
}

/** Effective provider-cost rates for one channel + currency, in the rational form they are stored. */
export async function readCostRates(
  db: Db,
  channel: string,
  currency: Currency,
): Promise<CostRateRow[]> {
  const rows = await db
    .select()
    .from(providerCostRates)
    .where(
      and(
        eq(providerCostRates.channel, channel),
        eq(providerCostRates.currency, currency),
        lte(providerCostRates.effectiveFrom, sql`now()`),
        or(
          isNull(providerCostRates.effectiveTo),
          gt(providerCostRates.effectiveTo, sql`now()`),
        ),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    providerVendor: row.providerVendor,
    destinationCountry: row.destinationCountry,
    trafficClass: row.trafficClass,
    numeratorMinor: row.numeratorMinor,
    denominator: row.denominator,
    sourceReference: row.sourceReference,
  }));
}

/**
 * Which prepaid catalog a workspace buys from (COM-011): its assignment, else the default token book.
 * Returns null when neither exists — a workspace with nothing to buy is a real state the caller must
 * render, not an error to invent a catalog for.
 */
export async function resolveOfferCatalogId(
  db: Db,
  tenantId: string,
): Promise<string | null> {
  const [assigned] = await db
    .select({ priceBookId: offerCatalogAssignments.priceBookId })
    .from(offerCatalogAssignments)
    .where(eq(offerCatalogAssignments.tenantId, tenantId as TenantId))
    .limit(1);
  if (assigned) return assigned.priceBookId;
  const [fallback] = await db
    .select({ id: priceBooks.id })
    .from(priceBooks)
    .where(and(eq(priceBooks.mode, "token"), eq(priceBooks.isDefault, true)))
    .limit(1);
  return fallback?.id ?? null;
}
