import { randomUUID } from "node:crypto";
import {
  accounts,
  createProvisioningDb,
  type MinorUnits,
  priceBooks,
  priceBookVersions,
  pricingSellRules,
  providerCostRates,
  type TenantId,
} from "@app/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EffectivePricingUnavailableError } from "./effective-pricing.js";
import { EffectivePricingService } from "./effective-pricing.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("effective pricing", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new EffectivePricingService(db);
  const accountId = randomUUID();
  const providerVendor = `test-provider-${randomUUID()}`;
  let bookId = "";
  let versionId = "";

  beforeAll(async () => {
    const [book] = await db.db
      .insert(priceBooks)
      .values({
        name: `Effective ${randomUUID()}`,
        mode: "subscription",
      })
      .returning({ id: priceBooks.id });
    if (!book) throw new Error("book not created");
    bookId = book.id;
    const [version] = await db.db
      .insert(priceBookVersions)
      .values({
        priceBookId: bookId,
        version: 1,
        status: "published",
        minimumMarginBps: 3_000,
      })
      .returning({ id: priceBookVersions.id });
    if (!version) throw new Error("version not created");
    versionId = version.id;
    await db.db.insert(pricingSellRules).values({
      versionId,
      channel: "sms",
      currency: "GHS",
      unitBasis: "segment",
      unitPriceMinor: 10n as MinorUnits,
    });
    await db.db.insert(providerCostRates).values([
      {
        providerVendor,
        channel: "sms",
        currency: "GHS",
        unitBasis: "segment",
        numeratorMinor: 4n,
        denominator: 1n,
        sourceReference: "test-wildcard",
      },
      {
        providerVendor,
        channel: "sms",
        destinationCountry: "GH",
        currency: "GHS",
        unitBasis: "segment",
        numeratorMinor: 6n,
        denominator: 1n,
        sourceReference: "test-gh",
      },
    ]);
    await db.db.insert(accounts).values({
      id: accountId as TenantId,
      name: "Effective pricing",
      slug: `effective-${accountId}`,
      priceBookId: bookId,
      billingCurrency: "GHS",
    });
  });

  afterAll(async () => {
    await db.db.delete(accounts).where(eq(accounts.id, accountId as TenantId));
    await db.db
      .delete(providerCostRates)
      .where(eq(providerCostRates.providerVendor, providerVendor));
    await db.db
      .delete(pricingSellRules)
      .where(eq(pricingSellRules.versionId, versionId));
    await db.db
      .delete(priceBookVersions)
      .where(eq(priceBookVersions.id, versionId));
    await db.db.delete(priceBooks).where(eq(priceBooks.id, bookId));
    await db.end();
  });

  it("selects the most specific cost and snapshots exact totals", async () => {
    const configuredCosts = await db.db
      .select()
      .from(providerCostRates)
      .where(eq(providerCostRates.providerVendor, providerVendor));
    expect(configuredCosts).toHaveLength(2);
    expect(configuredCosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerVendor,
          destinationCountry: "GH",
          trafficClass: null,
          currency: "GHS",
        }),
      ]),
    );
    const quote = await service.quote({
      accountId,
      channel: "sms",
      units: 3n,
      providerVendor,
      destinationCountry: "GH",
      trafficClass: "transactional",
    });
    expect(quote.totalPriceMinor).toBe(30n);
    expect(quote.estimatedProviderCostMinor).toBe(18n);
    expect(quote.snapshot.destinationCountry).toBe("GH");
    expect(quote.snapshot.totalPriceMinor).toBe("30");
  });

  it("fails closed when no provider-cost configuration matches", async () => {
    await expect(
      service.quote({
        accountId,
        channel: "sms",
        units: 1n,
        providerVendor: "unknown-provider",
      }),
    ).rejects.toBeInstanceOf(EffectivePricingUnavailableError);
  });
});
