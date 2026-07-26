import type {
  PriceBookDto,
  PublicPricingResponse,
  UpsertPriceBookRequest,
} from "@app/contracts";
import {
  type MinorUnits,
  type PriceBook,
  type ProvisioningDb,
  priceBookRates,
  priceBooks,
} from "@app/db";
import { and, eq } from "drizzle-orm";

/**
 * Admin write helpers for price books (ADR-0010 slice 3). Pure DB operations against the provisioning
 * connection, kept out of PricingService so the hot-path resolver stays small. The service wraps these
 * with audit + cache invalidation.
 */

type Db = ProvisioningDb["db"];
/** The transaction handle inside db.transaction — same query surface, no `$client`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** All books with their full rate tables, newest first. */
export async function listPriceBooks(db: Db): Promise<PriceBookDto[]> {
  const books = await db.select().from(priceBooks).orderBy(priceBooks.name);
  const rates = await db.select().from(priceBookRates);
  return books.map((book) => toDto(book, rates));
}

/**
 * Create (id === null) or update a book and REPLACE its full rate set, in one transaction. Setting
 * `is_default` first clears the mode's current default (the partial unique index allows exactly one),
 * so the two never coexist mid-transaction.
 */
export async function upsertPriceBook(
  db: Db,
  id: string | null,
  req: UpsertPriceBookRequest,
): Promise<PriceBookDto | null> {
  return db.transaction(async (tx) => {
    // Validate an update target before changing either singleton flag. A stale or forged id must not
    // clear the current default/public book when the requested update ultimately returns not found.
    if (id) {
      const [existing] = await tx
        .select({ id: priceBooks.id })
        .from(priceBooks)
        .where(eq(priceBooks.id, id))
        .limit(1);
      if (!existing) return null;
    }

    // Clear the mode's existing default BEFORE this book claims it — avoids a partial-index collision.
    if (req.is_default) {
      await tx
        .update(priceBooks)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(eq(priceBooks.mode, req.mode), eq(priceBooks.isDefault, true)),
        );
    }
    // Public publication is independent of tenant defaulting and globally singular.
    if (req.is_public) {
      await tx
        .update(priceBooks)
        .set({ isPublic: false, updatedAt: new Date() })
        .where(eq(priceBooks.isPublic, true));
    }

    let bookId = id;
    if (id) {
      const [updated] = await tx
        .update(priceBooks)
        .set({
          name: req.name,
          mode: req.mode,
          description: req.description,
          isDefault: req.is_default,
          isPublic: req.is_public,
          updatedAt: new Date(),
        })
        .where(eq(priceBooks.id, id))
        .returning({ id: priceBooks.id });
      if (!updated) return null; // unknown id
    } else {
      const [inserted] = await tx
        .insert(priceBooks)
        .values({
          name: req.name,
          mode: req.mode,
          description: req.description,
          isDefault: req.is_default,
          isPublic: req.is_public,
        })
        .returning({ id: priceBooks.id });
      bookId = inserted?.id ?? null;
    }
    if (!bookId) return null;

    // Replace the rate set wholesale — a book always carries its complete price table.
    await tx
      .delete(priceBookRates)
      .where(eq(priceBookRates.priceBookId, bookId));
    await tx.insert(priceBookRates).values(
      req.rates.map((r) => ({
        priceBookId: bookId,
        channel: r.channel,
        currency: r.currency,
        unitPriceMinor: BigInt(r.unit_price_minor) as MinorUnits,
      })),
    );

    return readBook(tx, bookId);
  });
}

/** Read the one staff-published price snapshot without leaking book or tenant metadata. */
export async function readPublicPricing(
  db: Db,
): Promise<PublicPricingResponse | null> {
  const [book] = await db
    .select({
      id: priceBooks.id,
      updatedAt: priceBooks.updatedAt,
    })
    .from(priceBooks)
    .where(eq(priceBooks.isPublic, true))
    .limit(1);
  if (!book) return null;
  const rates = await db
    .select({
      channel: priceBookRates.channel,
      currency: priceBookRates.currency,
      unitPriceMinor: priceBookRates.unitPriceMinor,
    })
    .from(priceBookRates)
    .where(eq(priceBookRates.priceBookId, book.id))
    .orderBy(priceBookRates.currency, priceBookRates.channel);
  return {
    rates: rates.map((rate) => ({
      channel: rate.channel as "sms" | "email",
      currency: rate.currency,
      unit_price_minor: rate.unitPriceMinor.toString(),
      unit_basis: rate.channel === "sms" ? "segment" : "send",
    })),
    effective_at: book.updatedAt.toISOString(),
  };
}

/** Read one book + its rates as a DTO (post-write echo). Runs inside the upsert transaction. */
async function readBook(db: Tx, id: string): Promise<PriceBookDto | null> {
  const [book] = await db
    .select()
    .from(priceBooks)
    .where(eq(priceBooks.id, id))
    .limit(1);
  if (!book) return null;
  const rates = await db
    .select()
    .from(priceBookRates)
    .where(eq(priceBookRates.priceBookId, id));
  return toDto(book, rates);
}

function toDto(
  book: PriceBook,
  allRates: (typeof priceBookRates.$inferSelect)[],
): PriceBookDto {
  return {
    id: book.id,
    name: book.name,
    mode: book.mode as PriceBookDto["mode"],
    description: book.description,
    is_default: book.isDefault,
    is_public: book.isPublic,
    rates: allRates
      .filter((r) => r.priceBookId === book.id)
      .map((r) => ({
        channel: r.channel as "sms" | "email",
        currency: r.currency,
        unit_price_minor: r.unitPriceMinor.toString(),
      })),
    created_at: book.createdAt.toISOString(),
    updated_at: book.updatedAt.toISOString(),
  };
}
