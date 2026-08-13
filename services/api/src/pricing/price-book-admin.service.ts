import type {
  PriceBookDto,
  ProviderCostRateDto,
  ProviderCostRateInput,
  PublicPricingResponse,
  UpsertPriceBookRequest,
} from "@app/contracts";
import {
  accounts,
  type ProvisioningDb,
  priceBooks,
  providerCostRates,
  type TenantId,
} from "@app/db";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { UNIT_BASIS_BY_CHANNEL } from "./effective-pricing.js";
import { EffectivePricingService } from "./effective-pricing.service.js";
import { assertCostCoveredBySellRates } from "./margin-guard.js";
import {
  listPriceBooks,
  readPublicPricing,
  upsertPriceBook,
} from "./price-book-writes.js";
import { PricingService } from "./pricing.service.js";

/** The staff actor attributed to an audited price change (from the BFF x-actor-* headers). */
interface Actor {
  readonly email?: string | null;
  readonly staffId?: string | null;
}

/**
 * Admin-console price-book control plane (ADR-0010 slice 3) — kept separate from the hot-path
 * PricingService resolver. Every write is audited; a rate edit clears the resolver cache and an
 * assignment invalidates just that account, so a staff change takes effect within the send path's
 * cache TTL at the latest.
 */
@Injectable()
export class PriceBookAdminService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Optional()
    @Inject(EffectivePricingService)
    private readonly effectivePricing?: EffectivePricingService,
  ) {}

  /** All price books with their rates. Ensures the default book exists first. */
  async listBooks(): Promise<PriceBookDto[]> {
    await this.pricing.ensureDefaultBook();
    return listPriceBooks(this.provisioning.db);
  }

  async publicPricing(): Promise<PublicPricingResponse | null> {
    return readPublicPricing(this.provisioning.db);
  }

  /**
   * Create (id null) or update a book + its full rate set. A rate change can move ANY account priced
   * on this book, so the whole resolver cache is cleared (books are few). Returns null on unknown id.
   */
  async upsertBook(
    id: string | null,
    req: UpsertPriceBookRequest,
    actor: Actor,
  ): Promise<PriceBookDto | null> {
    const dto = await upsertPriceBook(this.provisioning.db, id, req);
    if (!dto) return null;
    this.pricing.clearCache();
    this.effectivePricing?.invalidateAll();
    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email ?? null,
      action: "price_book.upsert",
      targetType: "price_book",
      targetId: dto.id,
      summary: `Price book "${dto.name}" ${id ? "updated" : "created"}`,
      metadata: {
        mode: dto.mode,
        is_default: dto.is_default,
        is_public: dto.is_public,
        rate_count: dto.rates.length,
      },
    });
    return dto;
  }

  /**
   * Assign (or clear → default) an account's price book. Validates the book exists BEFORE the update
   * (a valid-but-unknown id would otherwise hit the FK and 500), invalidates that account, and audits.
   */
  async assignAccount(
    accountId: string,
    bookId: string | null,
    actor: Actor,
    billingCurrency?: "GHS" | "NGN" | "USD",
  ): Promise<"ok" | "account_not_found" | "book_not_found"> {
    if (bookId) {
      const [book] = await this.provisioning.db
        .select({ id: priceBooks.id })
        .from(priceBooks)
        .where(eq(priceBooks.id, bookId))
        .limit(1);
      if (!book) return "book_not_found";
    }
    const [updated] = await this.provisioning.db
      .update(accounts)
      .set({
        priceBookId: bookId,
        ...(billingCurrency ? { billingCurrency } : {}),
      })
      .where(eq(accounts.id, accountId as TenantId))
      .returning({ id: accounts.id });
    if (!updated) return "account_not_found";
    this.pricing.invalidate(accountId);
    this.effectivePricing?.invalidateAll();
    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email ?? null,
      action: "price_book.assign",
      targetType: "account",
      targetId: accountId,
      summary: bookId
        ? `Account assigned price book ${bookId}`
        : "Account price book cleared (→ default)",
      metadata: {
        price_book_id: bookId,
        ...(billingCurrency ? { billing_currency: billingCurrency } : {}),
      },
    });
    return "ok";
  }

  async listProviderCosts(): Promise<ProviderCostRateDto[]> {
    const rows = await this.provisioning.db
      .select()
      .from(providerCostRates)
      .orderBy(
        providerCostRates.providerVendor,
        providerCostRates.channel,
        desc(providerCostRates.effectiveFrom),
      );
    return rows.map((row) => ({
      id: row.id,
      provider_vendor: row.providerVendor,
      channel: row.channel as ProviderCostRateDto["channel"],
      destination_country: row.destinationCountry,
      traffic_class: row.trafficClass as ProviderCostRateDto["traffic_class"],
      currency: row.currency as ProviderCostRateDto["currency"],
      numerator_minor: row.numeratorMinor.toString(),
      denominator: row.denominator.toString(),
      source_reference: row.sourceReference,
      effective_from: row.effectiveFrom.toISOString(),
      effective_to: row.effectiveTo?.toISOString() ?? null,
    }));
  }

  async publishProviderCost(
    request: ProviderCostRateInput,
    actor: Actor,
  ): Promise<ProviderCostRateDto> {
    const effectiveFrom = request.effective_from
      ? new Date(request.effective_from)
      : new Date();
    const row = await this.provisioning.db.transaction(async (tx) => {
      const dimensions = and(
        eq(providerCostRates.providerVendor, request.provider_vendor),
        eq(providerCostRates.channel, request.channel),
        eq(providerCostRates.currency, request.currency),
        request.destination_country === null
          ? isNull(providerCostRates.destinationCountry)
          : eq(
              providerCostRates.destinationCountry,
              request.destination_country,
            ),
        request.traffic_class === null
          ? isNull(providerCostRates.trafficClass)
          : eq(providerCostRates.trafficClass, request.traffic_class),
        isNull(providerCostRates.effectiveTo),
      );
      const [current] = await tx
        .select({ effectiveFrom: providerCostRates.effectiveFrom })
        .from(providerCostRates)
        .where(dimensions)
        .limit(1);
      if (current && effectiveFrom <= current.effectiveFrom) {
        throw invalidRequest(
          "provider_cost_window_invalid",
          "A replacement provider cost must start after the current rate.",
          "effective_from",
        );
      }
      // The other direction of the same inversion: a cost published ABOVE prices that are already
      // live silently breaks every send on those books. Refused here, naming the books, rather than
      // discovered later as a channel outage.
      await assertCostCoveredBySellRates(tx, {
        channel: request.channel,
        currency: request.currency,
        numeratorMinor: BigInt(request.numerator_minor),
        denominator: BigInt(request.denominator),
        providerVendor: request.provider_vendor,
      });
      await tx
        .update(providerCostRates)
        .set({ effectiveTo: effectiveFrom, updatedAt: new Date() })
        .where(dimensions);
      const [created] = await tx
        .insert(providerCostRates)
        .values({
          providerVendor: request.provider_vendor,
          channel: request.channel,
          destinationCountry: request.destination_country,
          trafficClass: request.traffic_class,
          currency: request.currency,
          unitBasis: UNIT_BASIS_BY_CHANNEL[request.channel],
          numeratorMinor: BigInt(request.numerator_minor),
          denominator: BigInt(request.denominator),
          effectiveFrom,
          sourceReference: request.source_reference,
        })
        .returning();
      if (!created) throw new Error("Provider-cost insert returned no row.");
      return created;
    });
    this.effectivePricing?.invalidateAll();
    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email ?? null,
      action: "provider_cost.publish",
      targetType: "provider_cost_rate",
      targetId: row.id,
      summary: `Provider cost published for ${row.providerVendor}/${row.channel}/${row.currency}`,
      metadata: {
        provider_vendor: row.providerVendor,
        channel: row.channel,
        currency: row.currency,
        destination_country: row.destinationCountry,
        traffic_class: row.trafficClass,
        source_reference: row.sourceReference,
      },
    });
    return {
      id: row.id,
      provider_vendor: row.providerVendor,
      channel: row.channel as ProviderCostRateDto["channel"],
      destination_country: row.destinationCountry,
      traffic_class: row.trafficClass as ProviderCostRateDto["traffic_class"],
      currency: row.currency as ProviderCostRateDto["currency"],
      numerator_minor: row.numeratorMinor.toString(),
      denominator: row.denominator.toString(),
      source_reference: row.sourceReference,
      effective_from: row.effectiveFrom.toISOString(),
      effective_to: row.effectiveTo?.toISOString() ?? null,
    };
  }
}
