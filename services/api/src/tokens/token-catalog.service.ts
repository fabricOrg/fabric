import {
  type CommercialOfferPurchaseReceipt,
  type CustomerCommercialOfferCatalog,
  commercialOfferPurchaseReceiptSchema,
  customerCommercialOfferCatalogSchema,
} from "@app/contracts";
import {
  accounts,
  commercialOfferChannels,
  offerCatalogAssignments,
  type ProvisioningDb,
  priceBooks,
  pricingOffers,
  pricingOfferVersions,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { notFound } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";

/** Customer-safe reads for the assigned prepaid catalog and immutable purchase receipts. */
@Injectable()
export class TokenCatalogService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  async catalog(tenantId: string): Promise<CustomerCommercialOfferCatalog> {
    const [account] = await this.provisioning.db
      .select({ billingCurrency: accounts.billingCurrency })
      .from(accounts)
      .where(eq(accounts.id, tenantId as TenantId))
      .limit(1);
    if (!account) throw notFound("account_not_found", "Unknown workspace.");

    const catalogId = await this.resolveCatalogId(tenantId);
    if (!catalogId) return { catalog_name: "Prepaid offers", offers: [] };
    const [catalog] = await this.provisioning.db
      .select({ name: priceBooks.name })
      .from(priceBooks)
      .where(eq(priceBooks.id, catalogId))
      .limit(1);
    const rows = await this.provisioning.db
      .select({
        offer: pricingOffers,
        version: pricingOfferVersions,
        channelName: commercialOfferChannels.displayName,
        unitLabel: commercialOfferChannels.unitLabel,
      })
      .from(pricingOfferVersions)
      .innerJoin(
        pricingOffers,
        eq(pricingOffers.id, pricingOfferVersions.offerId),
      )
      .innerJoin(
        commercialOfferChannels,
        and(
          eq(commercialOfferChannels.code, pricingOffers.channelCode),
          eq(commercialOfferChannels.unitCode, pricingOffers.unitCode),
        ),
      )
      .where(
        and(
          eq(pricingOffers.priceBookId, catalogId),
          eq(pricingOfferVersions.status, "published"),
          eq(pricingOfferVersions.currency, account.billingCurrency),
          eq(commercialOfferChannels.isActive, true),
          // A catalog entry is displayed only when today's send path can consume its natural unit.
          // The data model remains registry-backed; enabling another channel removes this gate.
          eq(pricingOffers.channelCode, "sms"),
          lte(pricingOfferVersions.effectiveFrom, sql`now()`),
          or(
            isNull(pricingOfferVersions.effectiveTo),
            gt(pricingOfferVersions.effectiveTo, sql`now()`),
          ),
        ),
      )
      .orderBy(pricingOffers.name, pricingOfferVersions.version);

    return customerCommercialOfferCatalogSchema.parse({
      catalog_name: catalog?.name ?? "Prepaid offers",
      offers: rows
        // The current send context has no service-class dimension. Do not sell a promise that the
        // reservation path cannot prove eligible; future channel adapters can supply that context.
        .filter(
          ({ version }) =>
            (version.eligibility.serviceClasses ?? []).length === 0,
        )
        .map(({ offer, version, channelName, unitLabel }) => ({
          offer_version_id: version.id,
          offer_code: offer.code,
          name: offer.name,
          description: offer.description,
          channel_code: offer.channelCode,
          channel_name: channelName,
          unit_code: offer.unitCode,
          unit_label: unitLabel,
          paid_units: version.paidUnits.toString(),
          bonus_units: version.bonusUnits.toString(),
          total_units: version.totalUnits.toString(),
          total_price_minor: version.totalPriceMinor.toString(),
          currency: version.currency,
          minimum_pack_count: version.minimumPackCount,
          maximum_pack_count: version.maximumPackCount,
          eligibility: {
            destination_countries:
              version.eligibility.destinationCountries ?? [],
            traffic_classes: version.eligibility.trafficClasses ?? [],
            provider_vendors: version.eligibility.providerVendors ?? [],
            service_classes: version.eligibility.serviceClasses ?? [],
          },
          effective_to: version.effectiveTo?.toISOString() ?? null,
        })),
    });
  }

  async receipt(
    tenantId: string,
    reference: string,
  ): Promise<CommercialOfferPurchaseReceipt> {
    const [purchase] = await this.provisioning.db
      .select()
      .from(tokenPurchases)
      .where(
        and(
          eq(tokenPurchases.tenantId, tenantId as TenantId),
          eq(tokenPurchases.reference, reference),
          eq(tokenPurchases.pricingModel, "fixed_bundle"),
        ),
      )
      .limit(1);
    if (
      !purchase?.offerVersionId ||
      !purchase.offerSnapshot ||
      purchase.packCount === null
    ) {
      throw notFound("token_purchase_not_found", "Unknown token purchase.");
    }
    return commercialOfferPurchaseReceiptSchema.parse({
      reference: purchase.reference,
      status: purchase.status,
      offer_version_id: purchase.offerVersionId,
      offer_name: purchase.offerSnapshot.offerName,
      channel_code: purchase.channel,
      unit_code: purchase.offerSnapshot.unitCode,
      pack_count: purchase.packCount,
      quantity: purchase.quantity.toString(),
      amount_minor: purchase.amountMinor.toString(),
      currency: purchase.currency,
      created_at: purchase.createdAt.toISOString(),
      updated_at: purchase.updatedAt.toISOString(),
    });
  }

  private async resolveCatalogId(tenantId: string): Promise<string | null> {
    const [assigned] = await this.provisioning.db
      .select({ id: offerCatalogAssignments.priceBookId })
      .from(offerCatalogAssignments)
      .where(eq(offerCatalogAssignments.tenantId, tenantId as TenantId))
      .limit(1);
    if (assigned) return assigned.id;
    const [fallback] = await this.provisioning.db
      .select({ id: priceBooks.id })
      .from(priceBooks)
      .where(and(eq(priceBooks.mode, "token"), eq(priceBooks.isDefault, true)))
      .limit(1);
    return fallback?.id ?? null;
  }
}
