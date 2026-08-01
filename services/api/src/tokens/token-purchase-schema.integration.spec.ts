import { randomUUID } from "node:crypto";
import {
  accounts,
  createProvisioningDb,
  type MinorUnits,
  priceBooks,
  pricingOffers,
  pricingOfferVersions,
  staffUsers,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("token purchase database invariants", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const tenantId = randomUUID();
  let staffId: string;
  let bookId: string;
  let offerId: string;
  let versionId: string;

  afterAll(async () => {
    await owner`DELETE FROM token_purchases WHERE tenant_id = ${tenantId}::uuid`;
    if (versionId) {
      await owner`DELETE FROM pricing_offer_versions WHERE id = ${versionId}::uuid`;
    }
    if (offerId) {
      await owner`DELETE FROM pricing_offers WHERE id = ${offerId}::uuid`;
    }
    if (bookId) {
      await owner`DELETE FROM price_books WHERE id = ${bookId}::uuid`;
    }
    await owner`DELETE FROM accounts WHERE id = ${tenantId}::uuid`;
    if (staffId) {
      await owner`DELETE FROM staff_users WHERE id = ${staffId}::uuid`;
    }
    await Promise.all([db.end(), owner.end()]);
  });

  async function seedOfferVersion(): Promise<void> {
    await db.db.insert(accounts).values({
      id: tenantId as TenantId,
      name: "Purchase invariant",
      slug: `purchase-${tenantId}`,
      billingCurrency: "GHS",
    });
    const [staff] = await db.db
      .insert(staffUsers)
      .values({ email: `${randomUUID()}@staff.test`, role: "admin" })
      .returning({ id: staffUsers.id });
    const [book] = await db.db
      .insert(priceBooks)
      .values({ name: `Invariant ${randomUUID()}`, mode: "token" })
      .returning({ id: priceBooks.id });
    if (!staff || !book) throw new Error("fixture creation failed");
    staffId = staff.id;
    bookId = book.id;
    const [offer] = await db.db
      .insert(pricingOffers)
      .values({
        priceBookId: book.id,
        code: `invariant-${randomUUID().slice(0, 8)}`,
        name: "Invariant bundle",
        channelCode: "sms",
        unitCode: "segment",
      })
      .returning({ id: pricingOffers.id });
    if (!offer) throw new Error("offer fixture creation failed");
    offerId = offer.id;
    const [version] = await db.db
      .insert(pricingOfferVersions)
      .values({
        offerId: offer.id,
        version: 1,
        currency: "GHS",
        paidUnits: 200n,
        totalUnits: 200n,
        totalPriceMinor: 300n as MinorUnits,
        createdBy: staff.id,
      })
      .returning({ id: pricingOfferVersions.id });
    if (!version) throw new Error("version fixture creation failed");
    versionId = version.id;
  }

  it("rejects malformed bundles and accepts historical unit arithmetic", async () => {
    await seedOfferVersion();
    const snapshot = {
      offerCode: "invariant-bundle",
      offerName: "Invariant bundle",
      offerVersion: 1,
      channelCode: "sms",
      unitCode: "segment",
      paidUnits: "200",
      bonusUnits: "0",
      totalUnits: "200",
      totalPriceMinor: "300",
      eligibility: {},
    };
    await expect(
      db.db.insert(tokenPurchases).values({
        tenantId: tenantId as TenantId,
        reference: `token-${randomUUID()}`,
        providerMode: "sandbox",
        pricingModel: "fixed_bundle",
        offerVersionId: versionId,
        packCount: 1,
        unitsPerPackLocked: 200n,
        pricePerPackMinorLocked: 300n as MinorUnits,
        offerSnapshot: snapshot,
        channel: "sms",
        quantity: 200n,
        currency: "GHS",
        amountMinor: 301n as MinorUnits,
        email: "buyer@example.com",
      }),
    ).rejects.toThrow();

    await expect(
      db.db.insert(tokenPurchases).values({
        tenantId: tenantId as TenantId,
        reference: `token-${randomUUID()}`,
        channel: "sms",
        quantity: 3n,
        unitPriceMinorLocked: 5n as MinorUnits,
        currency: "GHS",
        amountMinor: 15n as MinorUnits,
        email: "legacy@example.com",
      }),
    ).resolves.toBeDefined();
  });
});
