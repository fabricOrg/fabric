import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { moneyMinor, type TenantId, timestamps } from "./_shared.js";

/**
 * PAYMENTS — top-up intents (wallet funding via a provider like Paystack). Platform-level (no RLS,
 * like audit_events): the provider WEBHOOK carries no tenant context, so it must read the intent by
 * `reference` to learn which tenant to credit. Access is api-only, always filtered by reference /
 * tenant. The ledger credit itself IS tenant-scoped (runs under withTenant), idempotent on the
 * reference — so a duplicate webhook never double-credits.
 */
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().$type<TenantId>(),
  reference: text("reference").notNull().unique(), // our idempotency key, e.g. "topup:{uuid}"
  provider: text("provider").notNull().default("paystack"),
  providerRef: text("provider_ref"),
  amountMinor: moneyMinor("amount_minor").notNull(),
  currency: text("currency").notNull(),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"), // pending | success | failed
  /**
   * WHICH credentials created this charge (ADR-0011). Nullable: intents predating the plugin path,
   * and any created through the env fallback, have none.
   *
   * `providerMode` is a security binding, not bookkeeping. A Paystack webhook is authenticated by
   * HMAC, and we hold BOTH a test and a live secret — so without pinning the mode, a webhook signed
   * with the test key could settle a live-mode reference and credit a real wallet. Test keys are
   * handled far more loosely than live ones, which is exactly what makes that worth preventing.
   *
   * `credentialVersion` lets an in-flight charge still be verified after its key is rotated, instead
   * of its webhook becoming permanently unverifiable the moment staff install a new one.
   */
  providerMode: text("provider_mode"), // sandbox | live
  pluginInstanceId: uuid("plugin_instance_id"),
  credentialVersion: integer("credential_version"),
  ...timestamps,
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
