import {
  type PurchaseCommercialOfferRequest,
  unsupportedEligibilityDimensions,
} from "@app/contracts";
import {
  accounts,
  commercialOfferChannels,
  type MinorUnits,
  offerCatalogAssignments,
  type ProvisioningDb,
  priceBooks,
  pricingOffers,
  pricingOfferVersionItems,
  pricingOfferVersions,
  type TenantId,
  type TokenOfferSnapshot,
  tokenPurchases,
} from "@app/db";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { invalidRequest } from "../http/api-error.js";

type Db = ProvisioningDb["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface CommercialOfferPurchaseIntent {
  readonly offerVersionId: string;
  readonly packCount: number;
  readonly items: readonly {
    channelCode: string;
    unitCode: string;
    quantity: bigint;
  }[];
  readonly amountMinor: bigint;
  readonly currency: string;
}

/**
 * Resolve and persist the immutable commercial promise before contacting Paystack. The shared lock
 * makes retirement wait until this intent exists, so "was it on sale when checkout began?" always
 * has one database-backed answer.
 */
export async function createCommercialOfferPurchaseIntent(
  db: Db,
  input: {
    readonly tenantId: string;
    readonly reference: string;
    readonly request: PurchaseCommercialOfferRequest;
    readonly providerMode: "sandbox" | "live";
    readonly pluginInstanceId: string | null;
    readonly credentialVersion: number | null;
  },
): Promise<CommercialOfferPurchaseIntent> {
  return db.transaction(async (tx) => {
    const catalogId = await resolveCatalogId(tx, input.tenantId);
    if (!catalogId) {
      throw invalidRequest(
        "offer_catalog_unavailable",
        "No prepaid offer catalog is assigned to this workspace.",
      );
    }

    const [row] = await tx
      .select({
        version: pricingOfferVersions,
        offer: pricingOffers,
        billingCurrency: accounts.billingCurrency,
        accountPlan: accounts.plan,
      })
      .from(pricingOfferVersions)
      .innerJoin(
        pricingOffers,
        eq(pricingOffers.id, pricingOfferVersions.offerId),
      )
      .innerJoin(accounts, eq(accounts.id, input.tenantId as TenantId))
      .where(
        and(
          eq(pricingOfferVersions.id, input.request.offer_version_id),
          eq(pricingOffers.priceBookId, catalogId),
          eq(pricingOfferVersions.status, "published"),
          lte(pricingOfferVersions.effectiveFrom, sql`now()`),
          or(
            isNull(pricingOfferVersions.effectiveTo),
            gt(pricingOfferVersions.effectiveTo, sql`now()`),
          ),
        ),
      )
      .for("share")
      .limit(1);
    if (!row) {
      throw invalidRequest(
        "commercial_offer_unavailable",
        "That offer is not published and effective in this workspace's catalog.",
        "offer_version_id",
      );
    }
    if (row.accountPlan === "sandbox") {
      throw invalidRequest(
        "sandbox_token_purchase_denied",
        "Sandbox workspaces use daily channel allowances and cannot purchase tokens.",
      );
    }
    const items = await tx
      .select({
        item: pricingOfferVersionItems,
        channelActive: commercialOfferChannels.isActive,
      })
      .from(pricingOfferVersionItems)
      .innerJoin(
        commercialOfferChannels,
        and(
          eq(
            commercialOfferChannels.code,
            pricingOfferVersionItems.channelCode,
          ),
          eq(
            commercialOfferChannels.unitCode,
            pricingOfferVersionItems.unitCode,
          ),
        ),
      )
      .where(eq(pricingOfferVersionItems.offerVersionId, row.version.id))
      .orderBy(pricingOfferVersionItems.position);
    if (
      items.length === 0 ||
      items.some(({ channelActive }) => !channelActive)
    ) {
      throw invalidRequest(
        "commercial_offer_channel_inactive",
        "One or more channels in this package are not available.",
      );
    }
    const consumableChannels = new Set(["sms", "email"]);
    if (items.some(({ item }) => !consumableChannels.has(item.channelCode))) {
      throw invalidRequest(
        "commercial_offer_consumption_unavailable",
        "One or more package channels cannot consume prepaid credits yet.",
      );
    }
    if (
      items.some(
        ({ item }) => (item.eligibility.serviceClasses ?? []).length > 0,
      )
    ) {
      throw invalidRequest(
        "commercial_offer_consumption_unavailable",
        "This offer requires a service class that the send path cannot verify yet.",
      );
    }
    // Last line of defence before money moves. An offer published before this rule existed would
    // otherwise still sell credits its own send path can never match.
    if (
      items.some(
        ({ item }) =>
          unsupportedEligibilityDimensions(item.channelCode, {
            destination_countries: item.eligibility.destinationCountries ?? [],
            traffic_classes: item.eligibility.trafficClasses ?? [],
            provider_vendors: item.eligibility.providerVendors ?? [],
            service_classes: item.eligibility.serviceClasses ?? [],
          }).length > 0,
      )
    ) {
      throw invalidRequest(
        "commercial_offer_consumption_unavailable",
        "This offer restricts a channel by something its send path cannot match, so its credits could not be spent.",
      );
    }
    if (row.version.currency !== row.billingCurrency) {
      throw invalidRequest(
        "commercial_offer_currency_mismatch",
        `This workspace purchases in ${row.billingCurrency}.`,
      );
    }
    assertPackCount(
      input.request.pack_count,
      row.version.minimumPackCount,
      row.version.maximumPackCount,
    );

    const packCount = BigInt(input.request.pack_count);
    const amountMinor = row.version.totalPriceMinor * packCount;
    if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidRequest(
        "commercial_offer_amount_too_large",
        "That pack count exceeds the largest exact payment amount. Choose fewer packs.",
        "pack_count",
      );
    }
    const snapshot: TokenOfferSnapshot = {
      offerCode: row.offer.code,
      offerName: row.offer.name,
      offerVersion: row.version.version,
      totalPriceMinor: row.version.totalPriceMinor.toString(),
      creditValidityDays: row.version.creditValidityDays,
      items: items.map(({ item }) => {
        if (item.allocatedPriceMinor === null) {
          throw invalidRequest(
            "commercial_offer_snapshot_invalid",
            "This package has no published price allocation.",
          );
        }
        return {
          itemId: item.id,
          channelCode: item.channelCode,
          unitCode: item.unitCode,
          paidUnits: item.paidUnits.toString(),
          bonusUnits: item.bonusUnits.toString(),
          totalUnits: item.totalUnits.toString(),
          allocatedPriceMinor: item.allocatedPriceMinor.toString(),
          eligibility: item.eligibility,
        };
      }),
    };

    await tx.insert(tokenPurchases).values({
      tenantId: input.tenantId as TenantId,
      reference: input.reference,
      providerMode: input.providerMode,
      pluginInstanceId: input.pluginInstanceId,
      credentialVersion: input.credentialVersion,
      offerVersionId: row.version.id,
      packCount: input.request.pack_count,
      pricePerPackMinorLocked: row.version.totalPriceMinor,
      offerSnapshot: snapshot,
      currency: row.version.currency,
      amountMinor: amountMinor as MinorUnits,
      email: input.request.email,
    });

    return {
      offerVersionId: row.version.id,
      packCount: input.request.pack_count,
      items: items.map(({ item }) => ({
        channelCode: item.channelCode,
        unitCode: item.unitCode,
        quantity: item.totalUnits * packCount,
      })),
      amountMinor,
      currency: row.version.currency,
    };
  });
}

async function resolveCatalogId(
  tx: Tx,
  tenantId: string,
): Promise<string | null> {
  const [assigned] = await tx
    .select({ id: offerCatalogAssignments.priceBookId })
    .from(offerCatalogAssignments)
    .where(eq(offerCatalogAssignments.tenantId, tenantId as TenantId))
    .limit(1);
  if (assigned) return assigned.id;
  const [fallback] = await tx
    .select({ id: priceBooks.id })
    .from(priceBooks)
    .where(and(eq(priceBooks.mode, "token"), eq(priceBooks.isDefault, true)))
    .limit(1);
  return fallback?.id ?? null;
}

function assertPackCount(
  packCount: number,
  minimum: number,
  maximum: number | null,
): void {
  if (packCount < minimum) {
    throw invalidRequest(
      "commercial_offer_pack_count_too_small",
      `Purchase at least ${minimum} pack${minimum === 1 ? "" : "s"}.`,
      "pack_count",
    );
  }
  if (maximum !== null && packCount > maximum) {
    throw invalidRequest(
      "commercial_offer_pack_count_too_large",
      `Purchase at most ${maximum} pack${maximum === 1 ? "" : "s"}.`,
      "pack_count",
    );
  }
}
