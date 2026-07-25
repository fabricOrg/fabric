import type { PriceBookDto, UpsertPriceBookRequest } from "@app/contracts";
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
    // Clear the mode's existing default BEFORE this book claims it — avoids a partial-index collision.
    if (req.is_default) {
      await tx
        .update(priceBooks)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(eq(priceBooks.mode, req.mode), eq(priceBooks.isDefault, true)),
        );
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
