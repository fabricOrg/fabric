import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, type TenantId, timestamps } from "./_shared.js";

/**
 * AUTO-TOP-UP settings — when a tenant's balance falls to/below `thresholdMinor`, Fabric auto-charges
 * the saved card (payment_authorizations) by `topUpMinor` and credits the wallet. Platform-level (no
 * RLS, like payments): read by the after-debit trigger which already knows the tenant. Requires a
 * reusable card authorization to actually fire. Amounts are exact bigint minor units.
 */
export const autoTopup = pgTable(
  "auto_topup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().unique().$type<TenantId>(),
    enabled: boolean("enabled").notNull().default(false),
    thresholdMinor: moneyMinor("threshold_minor").notNull(),
    topUpMinor: moneyMinor("top_up_minor").notNull(),
    currency: text("currency").notNull(),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("idx_auto_topup_due")
      .on(t.nextCheckAt, t.tenantId)
      .where(sql`${t.enabled} = true`),
  ],
);

export type AutoTopup = typeof autoTopup.$inferSelect;
export type NewAutoTopup = typeof autoTopup.$inferInsert;
