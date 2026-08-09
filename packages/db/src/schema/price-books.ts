import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, timestamps } from "./_shared.js";

/**
 * PRICE BOOKS (ADR-0010) — staff-configurable rate plans. Platform-level control-plane state (no
 * tenant/RLS, like kill_switches / staff_users): read through the elevated provisioning connection
 * and cached on the send path (fail-open to last-known-good). A book is a named set of per-channel,
 * per-currency unit prices. Each account is assigned ONE book (`accounts.price_book_id`, nullable →
 * fall back to the mode's default book). The wallet PAYG send prices against the account's book.
 *
 * `mode` reserves the token/subscription split from the ADR; Phase 1 ships only `subscription` books.
 * Token books (Phase 2) slot in with no schema change.
 */
export const priceBooks = pgTable(
  "price_books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    mode: text("mode").notNull(), // subscription | token (token = Phase 2)
    description: text("description").notNull().default(""),
    // The book new/unassigned accounts of this mode resolve to. At most one default per mode.
    isDefault: boolean("is_default").notNull().default(false),
    // The single staff-approved rate book whose sanitized rates may be shown on public surfaces.
    isPublic: boolean("is_public").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check("price_books_mode_chk", sql`${t.mode} in ('subscription', 'token')`),
    check(
      "price_books_public_subscription_chk",
      sql`not ${t.isPublic} or ${t.mode} = 'subscription'`,
    ),
    // Resolution must be unambiguous: only one default book per purchase mode.
    uniqueIndex("uniq_default_price_book_per_mode")
      .on(t.mode)
      .where(sql`${t.isDefault}`),
    uniqueIndex("uniq_public_price_book")
      .on(t.isPublic)
      .where(sql`${t.isPublic}`),
  ],
);

/**
 * A single unit price within a book. SMS is priced per SEGMENT, email FLAT per send (ADR-0010 §5 —
 * the 1/3/6 size tier is retired). `unit_price_minor` is exact bigint minor units (branded), never a
 * float. One row per (book, channel, currency); a currency with no row is UNPRICED and rejected on
 * the send path (never silently charged zero — mirrors `rateSegments`' UnknownCurrencyError).
 */
export const priceBookRates = pgTable(
  "price_book_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceBookId: uuid("price_book_id")
      .notNull()
      .references(() => priceBooks.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // sms | email | whatsapp
    currency: text("currency").notNull(), // ISO 4217, e.g. GHS
    unitPriceMinor: moneyMinor("unit_price_minor").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("uniq_price_book_rate").on(t.priceBookId, t.channel, t.currency),
    check(
      "price_book_rates_channel_chk",
      sql`${t.channel} in ('sms', 'email', 'whatsapp')`,
    ),
    // Money invariant at the DB layer (correct-by-construction): a unit price is strictly positive.
    // A zero row would price a free send — the per-channel resolution guard checks key PRESENCE, not
    // value, so this is the only place that forbids `0`. Blocks a slice-3 bug / manual UPDATE regressing it.
    check("price_book_rates_price_chk", sql`${t.unitPriceMinor} > 0`),
  ],
);

export type PriceBook = typeof priceBooks.$inferSelect;
export type NewPriceBook = typeof priceBooks.$inferInsert;
export type PriceBookRate = typeof priceBookRates.$inferSelect;
export type NewPriceBookRate = typeof priceBookRates.$inferInsert;
