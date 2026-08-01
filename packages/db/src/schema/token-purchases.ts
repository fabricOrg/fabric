import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, type TenantId, timestamps } from "./_shared.js";
import {
  type CommercialOfferEligibility,
  pricingOfferVersions,
} from "./commercial-offers.js";

export interface TokenOfferSnapshot {
  readonly offerCode: string;
  readonly offerName: string;
  readonly offerVersion: number;
  readonly totalPriceMinor: string;
  readonly creditValidityDays: number | null;
  readonly items: readonly TokenOfferItemSnapshot[];
}

export interface TokenOfferItemSnapshot {
  readonly itemId: string;
  readonly channelCode: string;
  readonly unitCode: string;
  readonly paidUnits: string;
  readonly bonusUnits: string;
  readonly totalUnits: string;
  readonly allocatedPriceMinor: string;
  readonly eligibility: CommercialOfferEligibility;
}

/**
 * A token purchase intent is platform-level because the provider webhook has no tenant context and
 * resolves the tenant from our reference. The immutable promise comes from this row, never from the
 * callback payload, and the database checks keep its charged amount tied to its entitlement.
 */
export const tokenPurchases = pgTable(
  "token_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().$type<TenantId>(),
    reference: text("reference").notNull().unique(),
    provider: text("provider").notNull().default("paystack"),
    providerRef: text("provider_ref"),
    /** A test-key webhook must never settle a live-mode purchase intent. */
    providerMode: text("provider_mode"),
    pluginInstanceId: uuid("plugin_instance_id"),
    credentialVersion: integer("credential_version"),
    offerVersionId: uuid("offer_version_id").references(
      () => pricingOfferVersions.id,
      { onDelete: "restrict" },
    ),
    packCount: integer("pack_count"),
    pricePerPackMinorLocked: moneyMinor("price_per_pack_minor_locked"),
    offerSnapshot: jsonb("offer_snapshot").$type<TokenOfferSnapshot>(),
    currency: text("currency").notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
    email: text("email").notNull(),
    status: text("status").notNull().default("pending"),
    ...timestamps,
  },
  (t) => [
    check(
      "token_purchases_status_chk",
      sql`${t.status} in ('pending', 'success', 'failed')`,
    ),
    check(
      "token_purchases_provider_mode_chk",
      sql`${t.providerMode} is null or ${t.providerMode} in ('sandbox', 'live')`,
    ),
    // Every purchase is a package: exact pack multiplication, no unit price to divide by.
    check(
      "token_purchases_amount_chk",
      sql`${t.offerVersionId} is not null
        and ${t.packCount} > 0
        and ${t.pricePerPackMinorLocked} > 0
        and ${t.offerSnapshot} is not null
        and ${t.amountMinor} = ${t.pricePerPackMinorLocked} * ${t.packCount}`,
    ),
    index("idx_token_purchases_tenant").on(t.tenantId, t.createdAt),
  ],
);

export type TokenPurchase = typeof tokenPurchases.$inferSelect;
export type NewTokenPurchase = typeof tokenPurchases.$inferInsert;
