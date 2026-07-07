import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { type TenantId, timestamps } from "./_shared.js";

/**
 * PAYMENT AUTHORIZATIONS — a reusable card token captured from a provider `charge.success`. Enables
 * charging the customer WITHOUT them present (auto top-up). The `authorization_code` is a provider
 * token, NOT the card number — the PAN never touches Fabric. Only reusable card authorizations are
 * stored (mobile-money auths are typically non-reusable). Platform-level (no RLS, like payments):
 * written by the tenant-less webhook, one row per tenant (latest reusable authorization wins).
 */
export const paymentAuthorizations = pgTable("payment_authorizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().$type<TenantId>(),
  provider: text("provider").notNull().default("paystack"),
  authorizationCode: text("authorization_code").notNull(),
  cardType: text("card_type"), // e.g. "visa", "mastercard"
  last4: text("last4"),
  expMonth: text("exp_month"),
  expYear: text("exp_year"),
  bank: text("bank"),
  reusable: boolean("reusable").notNull().default(true),
  ...timestamps,
});

export type PaymentAuthorization = typeof paymentAuthorizations.$inferSelect;
export type NewPaymentAuthorization = typeof paymentAuthorizations.$inferInsert;
