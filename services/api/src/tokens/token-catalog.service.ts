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
  pricingOfferVersionItems,
  pricingOfferVersions,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
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
      })
      .from(pricingOfferVersions)
      .innerJoin(
        pricingOffers,
        eq(pricingOffers.id, pricingOfferVersions.offerId),
      )
      .where(
        and(
          eq(pricingOffers.priceBookId, catalogId),
          eq(pricingOfferVersions.status, "published"),
          eq(pricingOfferVersions.currency, account.billingCurrency),
          lte(pricingOfferVersions.effectiveFrom, sql`now()`),
          or(
            isNull(pricingOfferVersions.effectiveTo),
            gt(pricingOfferVersions.effectiveTo, sql`now()`),
          ),
        ),
      )
      .orderBy(pricingOffers.name, pricingOfferVersions.version);
    const versionIds = rows.map(({ version }) => version.id);
    const itemRows =
      versionIds.length === 0
        ? []
        : await this.provisioning.db
            .select({
              item: pricingOfferVersionItems,
              channelName: commercialOfferChannels.displayName,
              unitLabel: commercialOfferChannels.unitLabel,
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
            .where(inArray(pricingOfferVersionItems.offerVersionId, versionIds))
            .orderBy(
              pricingOfferVersionItems.offerVersionId,
              pricingOfferVersionItems.position,
            );
    const itemsByVersion = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const existing = itemsByVersion.get(item.item.offerVersionId) ?? [];
      existing.push(item);
      itemsByVersion.set(item.item.offerVersionId, existing);
    }
    // What this workspace has already bought, per PACKAGE rather than per version: buying v1 is
    // still part of your history when v2 is the one on sale.
    const purchasedRows =
      rows.length === 0
        ? []
        : await this.provisioning.db
            .select({
              offerId: pricingOfferVersions.offerId,
              packs: sql<string>`coalesce(sum(${tokenPurchases.packCount}), 0)`,
            })
            .from(tokenPurchases)
            .innerJoin(
              pricingOfferVersions,
              eq(pricingOfferVersions.id, tokenPurchases.offerVersionId),
            )
            .where(
              and(
                eq(tokenPurchases.tenantId, tenantId as TenantId),
                eq(tokenPurchases.status, "success"),
                inArray(
                  pricingOfferVersions.offerId,
                  rows.map((row) => row.offer.id),
                ),
              ),
            )
            .groupBy(pricingOfferVersions.offerId);
    const packsByOffer = new Map(
      purchasedRows.map((row) => [row.offerId, Number(row.packs)]),
    );

    const consumableChannels = new Set(["sms", "email"]);

    return customerCommercialOfferCatalogSchema.parse({
      catalog_name: catalog?.name ?? "Prepaid offers",
      offers: rows
        // The current send context has no service-class dimension. Do not sell a promise that the
        // reservation path cannot prove eligible; future channel adapters can supply that context.
        .filter(({ version }) => {
          const items = itemsByVersion.get(version.id) ?? [];
          return (
            items.length > 0 &&
            items.every(
              ({ item, channelActive }) =>
                channelActive &&
                consumableChannels.has(item.channelCode) &&
                (item.eligibility.serviceClasses ?? []).length === 0,
            )
          );
        })
        .map(({ offer, version }) => ({
          offer_version_id: version.id,
          offer_code: offer.code,
          name: offer.name,
          description: offer.description,
          items: (itemsByVersion.get(version.id) ?? []).map(
            ({ item, channelName, unitLabel }) => ({
              channel_code: item.channelCode,
              channel_name: channelName,
              unit_code: item.unitCode,
              unit_label: unitLabel,
              paid_units: item.paidUnits.toString(),
              bonus_units: item.bonusUnits.toString(),
              total_units: item.totalUnits.toString(),
              eligibility: {
                destination_countries:
                  item.eligibility.destinationCountries ?? [],
                traffic_classes: item.eligibility.trafficClasses ?? [],
                provider_vendors: item.eligibility.providerVendors ?? [],
                service_classes: item.eligibility.serviceClasses ?? [],
              },
            }),
          ),
          total_price_minor: version.totalPriceMinor.toString(),
          currency: version.currency,
          minimum_pack_count: version.minimumPackCount,
          maximum_pack_count: version.maximumPackCount,
          credit_validity_days: version.creditValidityDays,
          effective_to: version.effectiveTo?.toISOString() ?? null,
          purchased_packs: packsByOffer.get(offer.id) ?? 0,
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
    const packCount = purchase.packCount;
    return commercialOfferPurchaseReceiptSchema.parse({
      reference: purchase.reference,
      status: purchase.status,
      offer_version_id: purchase.offerVersionId,
      offer_name: purchase.offerSnapshot.offerName,
      items: purchase.offerSnapshot.items.map((item) => ({
        channel_code: item.channelCode,
        unit_code: item.unitCode,
        quantity: (BigInt(item.totalUnits) * BigInt(packCount)).toString(),
      })),
      pack_count: packCount,
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
