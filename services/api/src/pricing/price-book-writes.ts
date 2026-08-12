import type {
  PriceBookDto,
  PriceBookRateDto,
  PublicPricingResponse,
  UpsertPriceBookRequest,
} from "@app/contracts";
import {
  type MinorUnits,
  type PriceBook,
  type ProvisioningDb,
  priceBookRates,
  priceBooks,
  priceBookVersions,
  pricingSellRules,
} from "@app/db";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * Admin write helpers for price books (ADR-0010 slice 3). Pure DB operations against the provisioning
 * connection, kept out of PricingService so the hot-path resolver stays small. The service wraps these
 * with audit + cache invalidation.
 */

type Db = ProvisioningDb["db"];
/** The transaction handle inside db.transaction — same query surface, no `$client`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** All books with their full rate tables, newest first. */
type PriceBookRateChannel = PriceBookRateDto["channel"];

/** The unit each channel's price is QUOTED in, for the DTO. Total by construction: a new channel
 *  breaks the build. */
const UNIT_BASIS: Record<PriceBookRateChannel, "segment" | "send" | "message"> =
  {
    sms: "segment",
    email: "send",
    whatsapp: "message",
  };

/**
 * The unit each channel is STORED as in `pricing_sell_rules`. Deliberately separate from UNIT_BASIS:
 * email quotes "per send" to a reader but the table's basis check demands 'recipient', so the two
 * vocabularies agree on sms and whatsapp and disagree on email. Collapsing them breaks email books.
 */
const SELL_RULE_BASIS: Record<
  PriceBookRateChannel,
  "segment" | "recipient" | "message"
> = {
  sms: "segment",
  email: "recipient",
  whatsapp: "message",
};

export async function listPriceBooks(db: Db): Promise<PriceBookDto[]> {
  const books = await db.select().from(priceBooks).orderBy(priceBooks.name);
  const rates = await db.select().from(priceBookRates);
  const versions = await db
    .select()
    .from(priceBookVersions)
    .orderBy(desc(priceBookVersions.version));
  return books.map((book) => toDto(book, rates, versions));
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

    const [latest] = await tx
      .select({ version: priceBookVersions.version })
      .from(priceBookVersions)
      .where(eq(priceBookVersions.priceBookId, bookId))
      .orderBy(desc(priceBookVersions.version))
      .limit(1);
    await tx
      .update(priceBookVersions)
      .set({
        status: "retired",
        // The database owns effective_from. Keep the whole window on its clock and
        // advance one microsecond when an earlier app clock would invert the range.
        effectiveTo: sql`greatest(clock_timestamp(), ${priceBookVersions.effectiveFrom} + interval '1 microsecond')`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(priceBookVersions.priceBookId, bookId),
          eq(priceBookVersions.status, "published"),
        ),
      );
    const [published] = await tx
      .insert(priceBookVersions)
      .values({
        priceBookId: bookId,
        version: (latest?.version ?? 0) + 1,
        status: "published",
        minimumMarginBps: req.minimum_margin_bps ?? 2_000,
        sourceSnapshot: {
          rates: req.rates,
          minimum_margin_bps: req.minimum_margin_bps ?? 2_000,
        },
      })
      .returning({ id: priceBookVersions.id });
    if (!published)
      throw new Error("Price-book version insert returned no row.");
    await tx.insert(pricingSellRules).values(
      req.rates.map((rate) => ({
        versionId: published.id,
        channel: rate.channel,
        currency: rate.currency,
        // Keyed off the same map the read path uses. As a two-way ternary this wrote "recipient"
        // for WhatsApp, which pricing_sell_rules_basis_chk rejects outright — the insert failed, the
        // transaction rolled back, and the whole create surfaced as an opaque 500. ADR-0014 §3
        // prices WhatsApp per template message.
        unitBasis: SELL_RULE_BASIS[rate.channel],
        unitPriceMinor: BigInt(rate.unit_price_minor) as MinorUnits,
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
    rates: rates.map((rate) => {
      const channel = rate.channel as PriceBookRateChannel;
      return {
        channel,
        currency: rate.currency,
        unit_price_minor: rate.unitPriceMinor.toString(),
        // Keyed, not a two-way ternary. Under `channel === "sms" ? "segment" : "send"` a WhatsApp rate
        // reported "send", which is not a unit anyone sells WhatsApp in and not what the sell rules
        // record (ADR-0014 §3 prices per template message).
        unit_basis: UNIT_BASIS[channel],
      };
    }),
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
  const versions = await db
    .select()
    .from(priceBookVersions)
    .where(eq(priceBookVersions.priceBookId, id))
    .orderBy(desc(priceBookVersions.version));
  return toDto(book, rates, versions);
}

function toDto(
  book: PriceBook,
  allRates: (typeof priceBookRates.$inferSelect)[],
  versions: (typeof priceBookVersions.$inferSelect)[],
): PriceBookDto {
  const currentVersion = versions.find(
    (version) =>
      version.priceBookId === book.id && version.status === "published",
  );
  return {
    id: book.id,
    name: book.name,
    mode: book.mode as PriceBookDto["mode"],
    description: book.description,
    is_default: book.isDefault,
    is_public: book.isPublic,
    minimum_margin_bps: currentVersion?.minimumMarginBps ?? 0,
    rates: allRates
      .filter((r) => r.priceBookId === book.id)
      .map((r) => ({
        channel: r.channel as PriceBookRateChannel,
        currency: r.currency,
        unit_price_minor: r.unitPriceMinor.toString(),
      })),
    created_at: book.createdAt.toISOString(),
    updated_at: book.updatedAt.toISOString(),
  };
}
