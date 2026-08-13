import { randomUUID } from "node:crypto";
import type {
  ApiErrorEnvelope,
  Currency,
  PriceBookRateDto,
} from "@app/contracts";
import {
  createProvisioningDb,
  priceBooks,
  priceBookVersions,
  pricingSellRules,
} from "@app/db";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import { PriceBookAdminService } from "./price-book-admin.service.js";
import { PricingService } from "./pricing.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;
const actor = { email: "ops@fabric.dev", staffId: null };

/** The thrown value is a Nest HttpException whose BODY is the F8.3 envelope, not a bare `code`. */
function isMarginViolation(error: unknown): boolean {
  const body = (error as { getResponse?: () => unknown }).getResponse?.();
  return (
    (body as ApiErrorEnvelope | undefined)?.error.code ===
    "pricing_margin_violation"
  );
}

/**
 * A price the send path could never quote on must not be writable — from EITHER side of the
 * inversion. WhatsApp was unsendable in testing because the default book sold at GHS 0.12 against a
 * GHS 2.00 cost; the save succeeded and every send failed afterwards.
 *
 * Every fixture here is scoped to a THROWAWAY vendor and a currency no other spec prices, because
 * these specs run in parallel against ONE shared database and a real-currency cost row would change
 * what every other spec's books are allowed to charge.
 */
describeDb("pricing margin guard", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const admin = new PriceBookAdminService(
    db,
    new AuditService(db),
    new PricingService(db),
  );
  const bookIds: string[] = [];
  const vendors: string[] = [];

  function req(
    rates: {
      channel: PriceBookRateDto["channel"];
      currency: Currency;
      p: string;
    }[],
  ) {
    return {
      name: `Guard — ${randomUUID()}`,
      mode: "subscription" as const,
      description: "",
      is_default: false,
      is_public: false,
      rates: rates.map((r) => ({
        channel: r.channel,
        currency: r.currency,
        unit_price_minor: r.p,
      })),
    };
  }

  afterAll(async () => {
    for (const vendor of vendors) {
      await db.db.execute(
        sql`DELETE FROM provider_cost_rates WHERE provider_vendor = ${vendor}`,
      );
    }
    if (bookIds.length > 0) {
      const versions = await db.db
        .select({ id: priceBookVersions.id })
        .from(priceBookVersions)
        .where(inArray(priceBookVersions.priceBookId, bookIds));
      for (const version of versions) {
        await db.db
          .delete(pricingSellRules)
          .where(eq(pricingSellRules.versionId, version.id));
      }
      await db.db
        .delete(priceBookVersions)
        .where(inArray(priceBookVersions.priceBookId, bookIds));
      await db.db.delete(priceBooks).where(inArray(priceBooks.id, bookIds));
    }
    await db.end();
  });

  // The outage this guard exists for: the default book sold WhatsApp at GHS 0.12 against a GHS 2.00
  // provider cost. The save succeeded, and every send failed afterwards with "WhatsApp sending is
  // unavailable". A price the send path cannot quote on must not be writable.
  //
  // The cost row is scoped to a THROWAWAY currency, not GHS: these specs run in parallel against one
  // shared database, and a real-currency cost row would change what every other spec's books are
  // allowed to charge.
  it("refuses a sell price the send path could never quote on", async () => {
    const vendor = `margin-guard-${randomUUID()}`;
    await db.db.execute(sql`
      INSERT INTO provider_cost_rates
        (provider_vendor, channel, currency, unit_basis, numerator_minor, denominator, effective_from)
      VALUES (${vendor}, 'whatsapp', 'USD', 'message', 200, 1, now() - interval '1 hour')`);
    vendors.push(vendor);

    const belowCost = req([{ channel: "whatsapp", currency: "USD", p: "12" }]);
    // 249 is above cost but still inside the 20% floor over a cost of 200.
    const insideFloor = req([
      { channel: "whatsapp", currency: "USD", p: "249" },
    ]);
    const rejected = [belowCost.name, insideFloor.name];

    await expect(admin.upsertBook(null, belowCost, actor)).rejects.toSatisfy(
      isMarginViolation,
    );
    await expect(admin.upsertBook(null, insideFloor, actor)).rejects.toSatisfy(
      isMarginViolation,
    );

    const ok = await admin.upsertBook(
      null,
      req([{ channel: "whatsapp", currency: "USD", p: "250" }]),
      actor,
    );
    expect(ok).not.toBeNull();
    if (ok) bookIds.push(ok.id);

    // Nothing was written by the two refusals — the guard runs inside the transaction, so the only
    // book this test added is the one that passed. Counted by NAME rather than globally: these specs
    // share one database and a global count answers for every other spec's books too.
    const mine = await db.db.execute(sql`
      SELECT count(*)::int AS n FROM price_books WHERE name IN (${rejected[0]}, ${rejected[1]})`);
    expect(mine).toEqual([{ n: 0 }]);
  });

  it("refuses a provider cost that would break a live price", async () => {
    const vendor = `margin-guard-${randomUUID()}`;
    // Registered for cleanup BEFORE the attempt: if this guard ever regresses the publish SUCCEEDS,
    // and an un-cleaned active cost row silently reprices every other spec sharing this database.
    vendors.push(vendor);
    const book = await admin.upsertBook(
      null,
      req([{ channel: "whatsapp", currency: "USD", p: "300" }]),
      actor,
    );
    expect(book).not.toBeNull();
    if (book) bookIds.push(book.id);

    await expect(
      admin.publishProviderCost(
        {
          provider_vendor: vendor,
          channel: "whatsapp",
          currency: "USD",
          destination_country: null,
          traffic_class: null,
          numerator_minor: "500",
          denominator: "1",
          source_reference: "margin guard spec",
        },
        actor,
      ),
    ).rejects.toSatisfy(isMarginViolation);

    const rows = await db.db.execute(sql`
      SELECT count(*)::int AS n FROM provider_cost_rates WHERE provider_vendor = ${vendor}`);
    expect(rows).toEqual([{ n: 0 }]);
  });
});
