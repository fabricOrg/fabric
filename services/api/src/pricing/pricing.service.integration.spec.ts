import { randomUUID } from "node:crypto";
import {
  accounts,
  createProvisioningDb,
  type MinorUnits,
  priceBookRates,
  priceBooks,
} from "@app/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { PricingService } from "./pricing.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

/**
 * Real-Postgres coverage for ADR-0010 price resolution. Asserts the money-relevant invariants:
 * default rates for an unassigned account, an assigned book's rates, the TTL cache + invalidation,
 * fail-open to compiled defaults on a store outage, and the per-channel guard against an empty book
 * silently repricing to zero.
 */
describeDb("pricing resolution", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new PricingService(db);

  const createdAccountIds: string[] = [];
  const createdBookIds: string[] = [];

  async function makeAccount(priceBookId?: string): Promise<string> {
    const id = randomUUID();
    await db.db.insert(accounts).values({
      id: id as never,
      name: "Pricing test",
      slug: `pricing-${id}`,
      ...(priceBookId ? { priceBookId } : {}),
    });
    createdAccountIds.push(id);
    return id;
  }

  async function makeBook(rates: {
    sms?: Record<string, bigint>;
    email?: Record<string, bigint>;
  }): Promise<string> {
    const [book] = await db.db
      .insert(priceBooks)
      .values({
        name: `Test — ${randomUUID()}`,
        mode: "subscription",
        isDefault: false,
      })
      .returning({ id: priceBooks.id });
    const bookId = book?.id ?? "";
    createdBookIds.push(bookId);
    const rows = [
      ...Object.entries(rates.sms ?? {}).map(([currency, v]) => ({
        priceBookId: bookId,
        channel: "sms",
        currency,
        unitPriceMinor: v as MinorUnits,
      })),
      ...Object.entries(rates.email ?? {}).map(([currency, v]) => ({
        priceBookId: bookId,
        channel: "email",
        currency,
        unitPriceMinor: v as MinorUnits,
      })),
    ];
    if (rows.length > 0) await db.db.insert(priceBookRates).values(rows);
    return bookId;
  }

  afterAll(async () => {
    for (const id of createdAccountIds) {
      await db.db.delete(accounts).where(eq(accounts.id, id as never));
    }
    // price_book_rates cascade on the book delete.
    for (const id of createdBookIds) {
      await db.db.delete(priceBooks).where(eq(priceBooks.id, id));
    }
    await db.end();
  });

  it("seeds the default book and resolves default rates for an unassigned account", async () => {
    await service.ensureDefaultBook();
    const accountId = await makeAccount();

    const rates = await service.resolveRates(accountId);
    // Seeded default MUST equal the pre-ADR hardcoded rates → zero price change on launch.
    expect(rates.sms.GHS).toBe(3n);
    expect(rates.sms.NGN).toBe(400n);
    expect(rates.email.GHS).toBe(5n); // email flat per send
  });

  it("resolves an account's assigned book", async () => {
    const bookId = await makeBook({ sms: { GHS: 7n }, email: { GHS: 9n } });
    const accountId = await makeAccount(bookId);

    const rates = await service.resolveRates(accountId);
    expect(rates.sms.GHS).toBe(7n);
    expect(rates.email.GHS).toBe(9n);
  });

  it("serves the cache within the TTL and re-reads after invalidate", async () => {
    const bookId = await makeBook({ sms: { GHS: 7n }, email: { GHS: 9n } });
    const accountId = await makeAccount(bookId);

    expect((await service.resolveRates(accountId)).sms.GHS).toBe(7n);

    // Change the underlying price; the cached value must still serve until invalidated.
    await db.db
      .update(priceBookRates)
      .set({ unitPriceMinor: 11n as MinorUnits })
      .where(eq(priceBookRates.priceBookId, bookId));
    expect((await service.resolveRates(accountId)).sms.GHS).toBe(7n);

    service.invalidate(accountId);
    expect((await service.resolveRates(accountId)).sms.GHS).toBe(11n);
  });

  it("fails open to compiled defaults when the store read fails", async () => {
    // A deliberately unreachable provisioning connection — resolveRates must never throw.
    const brokenDb = createProvisioningDb(
      "postgresql://nobody:nobody@127.0.0.1:1/nope",
      { max: 1, connect_timeout: 1 },
    );
    const broken = new PricingService(brokenDb);
    const rates = await broken.resolveRates(randomUUID());
    expect(rates.sms.GHS).toBe(3n);
    expect(rates.email.GHS).toBe(5n);
    await brokenDb.end();
  });

  it("falls to compiled default per channel for an assigned-but-empty book", async () => {
    const bookId = await makeBook({}); // no rate rows
    const accountId = await makeAccount(bookId);

    const rates = await service.resolveRates(accountId);
    // An empty book must not silently reprice to zero.
    expect(rates.sms.GHS).toBe(3n);
    expect(rates.email.GHS).toBe(5n);
  });
});
