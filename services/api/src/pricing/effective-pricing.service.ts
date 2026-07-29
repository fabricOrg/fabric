import {
  accounts,
  type ProvisioningDb,
  priceBooks,
  priceBookVersions,
  pricingSellRules,
  providerCostRates,
  type TenantId,
} from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import {
  buildEffectiveQuote,
  type EffectivePriceConfig,
  type EffectivePriceInput,
  type EffectivePriceQuote,
  EffectivePricingUnavailableError,
} from "./effective-pricing.js";

interface CachedEffectivePrice {
  readonly config: EffectivePriceConfig;
  readonly fetchedAt: number;
}

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 10_000;

@Injectable()
export class EffectivePricingService {
  private readonly logger = new Logger(EffectivePricingService.name);
  private readonly cache = new Map<string, CachedEffectivePrice>();

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  /**
   * Resolve a live, wallet-backed quote. A control-plane outage may use last-known-good config, but
   * a cold miss fails closed: inventing a sell price or provider cost could lose money.
   */
  async quote(input: EffectivePriceInput): Promise<EffectivePriceQuote> {
    const key = cacheKey(input);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return buildEffectiveQuote(input, cached.config);
    }

    try {
      const config = await this.readConfig(input);
      if (this.cache.size >= CACHE_MAX_ENTRIES) this.pruneExpired();
      this.cache.set(key, { config, fetchedAt: Date.now() });
      return buildEffectiveQuote(input, config);
    } catch (error) {
      if (cached) {
        this.logger.error(
          `effective pricing refresh failed; serving last-known-good for ${key}: ${errorMessage(error)}`,
        );
        return buildEffectiveQuote(input, cached.config);
      }
      if (error instanceof EffectivePricingUnavailableError) throw error;
      throw new EffectivePricingUnavailableError(
        `Effective pricing could not be resolved: ${errorMessage(error)}`,
      );
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private async readConfig(
    input: EffectivePriceInput,
  ): Promise<EffectivePriceConfig> {
    const [account] = await this.provisioning.db
      .select({
        priceBookId: accounts.priceBookId,
        billingCurrency: accounts.billingCurrency,
      })
      .from(accounts)
      .where(eq(accounts.id, input.accountId as TenantId))
      .limit(1);
    if (!account) {
      throw new EffectivePricingUnavailableError("Account was not found.");
    }

    const priceBookId =
      account.priceBookId ?? (await this.defaultSubscriptionBookId());
    if (!priceBookId) {
      throw new EffectivePricingUnavailableError(
        "No price book is assigned to this account.",
      );
    }

    const [version] = await this.provisioning.db
      .select({
        id: priceBookVersions.id,
        minimumMarginBps: priceBookVersions.minimumMarginBps,
      })
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
    if (!version) {
      throw new EffectivePricingUnavailableError(
        "No published price-book version is effective.",
      );
    }

    const sellRules = await this.provisioning.db
      .select()
      .from(pricingSellRules)
      .where(
        and(
          eq(pricingSellRules.versionId, version.id),
          eq(pricingSellRules.channel, input.channel),
          eq(pricingSellRules.currency, account.billingCurrency),
        ),
      );
    const sellRule = selectMostSpecific(sellRules, input);
    if (!sellRule) {
      throw new EffectivePricingUnavailableError(
        `No ${input.channel} sell rule matches this message.`,
      );
    }

    const costRates = await this.provisioning.db
      .select()
      .from(providerCostRates)
      .where(
        and(
          eq(providerCostRates.providerVendor, input.providerVendor),
          eq(providerCostRates.channel, input.channel),
          eq(providerCostRates.currency, account.billingCurrency),
          lte(providerCostRates.effectiveFrom, sql`now()`),
          or(
            isNull(providerCostRates.effectiveTo),
            gt(providerCostRates.effectiveTo, sql`now()`),
          ),
        ),
      );
    const costRate = selectMostSpecific(costRates, input);
    if (!costRate) {
      throw new EffectivePricingUnavailableError(
        `No effective ${input.channel} provider-cost rate matches this message.`,
      );
    }

    return {
      priceBookVersionId: version.id,
      sellRuleId: sellRule.id,
      providerCostRateId: costRate.id,
      currency: account.billingCurrency,
      unitBasis: input.channel === "sms" ? "segment" : "recipient",
      unitPriceMinor: sellRule.unitPriceMinor,
      providerCostNumeratorMinor: costRate.numeratorMinor,
      providerCostDenominator: costRate.denominator,
      minimumMarginBps: version.minimumMarginBps,
    };
  }

  private async defaultSubscriptionBookId(): Promise<string | null> {
    const [book] = await this.provisioning.db
      .select({ id: priceBooks.id })
      .from(priceBooks)
      .where(
        and(
          eq(priceBooks.mode, "subscription"),
          eq(priceBooks.isDefault, true),
        ),
      )
      .limit(1);
    return book?.id ?? null;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.fetchedAt >= CACHE_TTL_MS) this.cache.delete(key);
    }
  }
}

interface DimensionalRule {
  readonly destinationCountry: string | null;
  readonly trafficClass: string | null;
  readonly providerVendor?: string | null;
}

function selectMostSpecific<T extends DimensionalRule>(
  rows: readonly T[],
  input: EffectivePriceInput,
): T | undefined {
  return rows
    .filter(
      (row) =>
        matches(row.destinationCountry, input.destinationCountry) &&
        matches(row.trafficClass, input.trafficClass) &&
        matches(row.providerVendor ?? null, input.providerVendor),
    )
    .sort((left, right) => specificity(right) - specificity(left))[0];
}

function matches(
  configured: string | null,
  actual: string | undefined,
): boolean {
  return configured === null || configured === actual;
}

function specificity(row: DimensionalRule): number {
  return (
    Number(row.destinationCountry !== null) +
    Number(row.trafficClass !== null) +
    Number((row.providerVendor ?? null) !== null)
  );
}

function cacheKey(input: EffectivePriceInput): string {
  return [
    input.accountId,
    input.channel,
    input.providerVendor,
    input.destinationCountry ?? "*",
    input.trafficClass ?? "*",
  ].join(":");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
