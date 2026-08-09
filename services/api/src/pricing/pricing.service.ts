import {
  accounts,
  type NewPriceBookRate,
  type ProvisioningDb,
  priceBookRates,
  priceBooks,
  priceBookVersions,
  pricingSellRules,
  type TenantId,
} from "@app/db";
import {
  DEFAULT_EMAIL_BASE_RATES,
  DEFAULT_RATES,
  DEFAULT_WHATSAPP_BASE_RATES,
  type RateTable,
} from "@app/domain";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import type { BillableChannel } from "./effective-pricing.js";
import { pick, ratesFor, versionedRatesFor } from "./pricing-defaults.js";

/**
 * PRICING (ADR-0010 Phase 1) — resolves the per-account rate table the wallet send path prices
 * against. Control-plane state (price_books / price_book_rates, no RLS) read through the elevated
 * provisioning connection, mirroring KillSwitchService: a short TTL cache keeps the control plane off
 * the data plane's hot path (ARCHITECTURE Principle #7), and a store-read failure serves
 * last-known-good — or the compiled default rates — rather than failing the send. The WALLET still
 * fails closed downstream (no funds → no send); only the PRICE resolution fails open.
 *
 * SMS is priced per segment, email FLAT per send (the size tier is retired in slice 2), WhatsApp FLAT
 * per template message (ADR-0014 §3). A currency with no configured rate is UNPRICED — resolveRates surfaces the book's rates as-is and the pure
 * rating functions reject the missing currency (UnknownCurrencyError), never charging zero.
 */

/** The resolved unit prices for one account: per-currency rate tables per channel. */
export interface ResolvedRates {
  readonly sms: RateTable;
  readonly email: RateTable;
  readonly whatsapp: RateTable;
}

interface CachedRates {
  readonly rates: ResolvedRates;
  readonly fetchedAt: number;
}

/** The compiled fallback — identical to the seeded default book, so a store outage never repriced. */
const COMPILED_DEFAULT: ResolvedRates = {
  sms: DEFAULT_RATES,
  // Email flat per send = the standard-tier base (the retired 1/3/6 multiplier's ×1 band).
  email: DEFAULT_EMAIL_BASE_RATES,
  whatsapp: DEFAULT_WHATSAPP_BASE_RATES,
};

/** The default book seeded for subscription accounts. Values MUST match COMPILED_DEFAULT. */
const DEFAULT_BOOK = {
  name: "Subscription — Standard",
  mode: "subscription" as const,
  description: "Default pay-as-you-go rate plan.",
} as const;

/**
 * How long a resolved rate table may serve reads before a fresh fetch. An admin price edit lands on
 * other instances within this window (matches the kill-switch cache TTL).
 */
const CACHE_TTL_MS = 30_000;

/**
 * Soft cap on the per-account cache. Above it, resolveRates sweeps expired entries before inserting
 * so the map can't grow unbounded on a many-tenant platform. Well above a busy instance's live
 * working set within one TTL window, so the sweep is rare and never evicts a fresh entry.
 */
const CACHE_MAX_ENTRIES = 10_000;

@Injectable()
export class PricingService implements OnModuleInit {
  private readonly logger = new Logger(PricingService.name);
  /** accountId → last-known-good resolved rates. Also the fallback when the control-plane read fails. */
  private readonly cache = new Map<string, CachedRates>();

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  /** Seed the default book once at boot so resolution reads real config (idempotent; safe to fail). */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaultBook();
    } catch (error) {
      // A boot-time seed failure is non-fatal: resolveRates falls open to COMPILED_DEFAULT until the
      // control plane is reachable. Log and continue rather than crash the API.
      this.logger.error(
        `default price-book seed failed at boot — resolution will use compiled defaults until reachable: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  /**
   * Resolve the rate tables the send/preview path prices against for `accountId`. Reads the account's
   * assigned book (or the subscription default when unassigned) through the TTL cache; on a read
   * failure serves last-known-good, then the compiled default. Never throws — a pricing-store outage
   * must not take down the data plane.
   */
  async resolveRates(accountId: string): Promise<ResolvedRates> {
    const cached = this.cache.get(accountId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.rates;
    }
    try {
      const rates = await this.readResolvedRates(accountId);
      if (this.cache.size >= CACHE_MAX_ENTRIES) this.pruneExpired();
      this.cache.set(accountId, { rates, fetchedAt: Date.now() });
      return rates;
    } catch (error) {
      this.logger.error(
        `price resolution failed for account '${accountId}' — serving ${
          cached ? "last-known-good" : "compiled default"
        }: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return cached ? cached.rates : COMPILED_DEFAULT;
    }
  }

  /** Read the account's book (assigned, else subscription default) and build its rate tables. */
  private async readResolvedRates(accountId: string): Promise<ResolvedRates> {
    const [account] = await this.provisioning.db
      .select({ priceBookId: accounts.priceBookId })
      .from(accounts)
      // accountId is the tenant id (accounts.id IS the tenant_id); brand it for the typed column.
      .where(eq(accounts.id, accountId as TenantId))
      .limit(1);

    const bookId =
      account?.priceBookId ?? (await this.defaultSubscriptionBookId());
    // No assignment AND no default book seeded yet → compiled default (fail open).
    if (!bookId) return COMPILED_DEFAULT;

    const rateRows = await this.provisioning.db
      .select({
        channel: priceBookRates.channel,
        currency: priceBookRates.currency,
        unitPriceMinor: priceBookRates.unitPriceMinor,
      })
      .from(priceBookRates)
      .where(eq(priceBookRates.priceBookId, bookId));

    // An assigned-but-empty book must not silently reprice everything to zero: fall to the compiled
    // default per channel when the book carries no rows for that channel.
    const tables: Record<BillableChannel, Record<string, bigint>> = {
      sms: {},
      email: {},
      whatsapp: {},
    };
    for (const row of rateRows) {
      // Keyed by the row's own channel. This used to be `row.channel === "email" ? email : sms`, which
      // was correct only while sms and email were the whole catalog — the moment the price book could
      // hold a whatsapp row, that fallthrough filed it under SMS and repriced every text message.
      const table = tables[row.channel as BillableChannel];
      if (!table) continue;
      table[row.currency] = row.unitPriceMinor;
    }
    return {
      sms: pick(tables.sms, COMPILED_DEFAULT.sms),
      email: pick(tables.email, COMPILED_DEFAULT.email),
      whatsapp: pick(tables.whatsapp, COMPILED_DEFAULT.whatsapp),
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

  /**
   * Seed the default subscription book + its rates (idempotent). Values mirror COMPILED_DEFAULT so
   * launching with the seeded book is a no-op price change. Called at boot (onModuleInit).
   *
   * Existence-gated: if a default subscription book already exists we do NOT attempt a second insert —
   * the partial unique index `uniq_default_price_book_per_mode` forbids two defaults per mode, so an
   * unconditional insert would throw (name conflict wouldn't cover an index conflict).
   */
  async ensureDefaultBook(): Promise<void> {
    let bookId = await this.defaultSubscriptionBookId();
    if (!bookId) {
      const [inserted] = await this.provisioning.db
        .insert(priceBooks)
        .values({ ...DEFAULT_BOOK, isDefault: true })
        .onConflictDoNothing({ target: priceBooks.name })
        .returning({ id: priceBooks.id });
      bookId = inserted?.id ?? (await this.defaultSubscriptionBookId());
    }
    if (!bookId) return;

    const rates: NewPriceBookRate[] = [
      ...ratesFor(bookId, "sms", COMPILED_DEFAULT.sms),
      ...ratesFor(bookId, "email", COMPILED_DEFAULT.email),
      ...ratesFor(bookId, "whatsapp", COMPILED_DEFAULT.whatsapp),
    ];
    await this.provisioning.db
      .insert(priceBookRates)
      .values(rates)
      .onConflictDoNothing({
        target: [
          priceBookRates.priceBookId,
          priceBookRates.channel,
          priceBookRates.currency,
        ],
      });
    const [existingVersion] = await this.provisioning.db
      .select({ id: priceBookVersions.id })
      .from(priceBookVersions)
      .where(eq(priceBookVersions.priceBookId, bookId))
      .limit(1);
    if (existingVersion) return;
    const [version] = await this.provisioning.db
      .insert(priceBookVersions)
      .values({
        priceBookId: bookId,
        version: 1,
        status: "published",
        minimumMarginBps: 2_000,
        sourceSnapshot: { source: "compiled_default" },
      })
      .onConflictDoNothing({
        target: [priceBookVersions.priceBookId, priceBookVersions.version],
      })
      .returning({ id: priceBookVersions.id });
    if (!version) return;
    await this.provisioning.db
      .insert(pricingSellRules)
      .values([
        ...versionedRatesFor(version.id, "sms", COMPILED_DEFAULT.sms),
        ...versionedRatesFor(version.id, "email", COMPILED_DEFAULT.email),
        ...versionedRatesFor(version.id, "whatsapp", COMPILED_DEFAULT.whatsapp),
      ]);
  }

  /** Drop the cache for one account (call after an admin reassigns/edits — slice 3). */
  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }

  /** Drop the whole cache — after a book's rates change, any account resolving to it must re-read. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Evict entries past the TTL — bounds cache growth on a many-tenant platform (see CACHE_MAX_ENTRIES). */
  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.fetchedAt >= CACHE_TTL_MS) this.cache.delete(key);
    }
  }
}
