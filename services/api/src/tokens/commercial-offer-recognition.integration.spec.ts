import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type MinorUnits,
  priceBooks,
  pricingOffers,
  pricingOfferVersions,
  staffUsers,
  type TenantId,
  tokenLots,
  tokenPurchases,
  tokenRecognitionAllocations,
} from "@app/db";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { grantTokensForPurchase } from "./token-grant.js";
import { holdTokens } from "./token-holds.js";
import { settleTokenHolds } from "./token-settlement.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

describeDb("fixed-total commercial-offer recognition", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 4 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const tenantIds: string[] = [];
  const offerIds: string[] = [];
  const bookIds: string[] = [];
  const staffIds: string[] = [];

  async function grantBundle(totalUnits: bigint, totalPrice: bigint) {
    const tenantId = randomUUID();
    await provisioning.db.insert(accounts).values({
      id: tenantId as TenantId,
      name: "Recognition buyer",
      slug: `recognition-${tenantId}`,
    });
    tenantIds.push(tenantId);
    const [author, approver] = await provisioning.db
      .insert(staffUsers)
      .values([
        { email: `${randomUUID()}@author.test`, role: "admin" },
        { email: `${randomUUID()}@approver.test`, role: "admin" },
      ])
      .returning({ id: staffUsers.id });
    if (!author || !approver) throw new Error("staff fixtures failed");
    staffIds.push(author.id, approver.id);
    const [book] = await provisioning.db
      .insert(priceBooks)
      .values({ name: `Recognition ${randomUUID()}`, mode: "token" })
      .returning({ id: priceBooks.id });
    if (!book) throw new Error("book fixture failed");
    bookIds.push(book.id);
    const [offer] = await provisioning.db
      .insert(pricingOffers)
      .values({
        priceBookId: book.id,
        code: `recognition-${randomUUID().slice(0, 8)}`,
        name: "Recognition bundle",
        channelCode: "sms",
        unitCode: "segment",
      })
      .returning({ id: pricingOffers.id });
    if (!offer) throw new Error("offer fixture failed");
    offerIds.push(offer.id);
    const now = new Date();
    const [version] = await provisioning.db
      .insert(pricingOfferVersions)
      .values({
        offerId: offer.id,
        version: 1,
        status: "published",
        currency: "GHS",
        paidUnits: totalUnits,
        bonusUnits: 0n,
        totalUnits,
        totalPriceMinor: totalPrice as MinorUnits,
        eligibility: { providerVendors: ["arkesel"] },
        costSnapshot: {
          bestCaseCostMinor: "0",
          worstCaseCostMinor: "0",
          bestCaseMarginMinor: totalPrice.toString(),
          worstCaseMarginMinor: totalPrice.toString(),
          worstCaseMarginBps: 10_000,
          minimumMarginBps: 0,
          minimumMarginSource: "platform_default",
          routeCount: 1,
          calculatedAt: now.toISOString(),
          sourceReferences: ["fixture"],
        },
        createdBy: author.id,
        approvedBy: approver.id,
        approvedAt: now,
      })
      .returning({ id: pricingOfferVersions.id });
    if (!version) throw new Error("version fixture failed");
    const reference = `token-${randomUUID()}`;
    const snapshot = {
      offerCode: "recognition",
      offerName: "Recognition bundle",
      offerVersion: 1,
      channelCode: "sms",
      unitCode: "segment",
      paidUnits: totalUnits.toString(),
      bonusUnits: "0",
      totalUnits: totalUnits.toString(),
      totalPriceMinor: totalPrice.toString(),
      eligibility: { providerVendors: ["arkesel"] },
    };
    await provisioning.db.insert(tokenPurchases).values({
      tenantId: tenantId as TenantId,
      reference,
      pricingModel: "fixed_bundle",
      offerVersionId: version.id,
      packCount: 1,
      unitsPerPackLocked: totalUnits,
      pricePerPackMinorLocked: totalPrice as MinorUnits,
      offerSnapshot: snapshot,
      channel: "sms",
      quantity: totalUnits,
      unitPriceMinorLocked: null,
      currency: "GHS",
      amountMinor: totalPrice as MinorUnits,
      email: "buyer@example.com",
    });
    const granted = await grantTokensForPurchase(
      { provisioning, appDb },
      reference,
    );
    return { tenantId, lotId: granted.lotId };
  }

  async function consume(tenantId: string, quantity: bigint) {
    const referenceId = randomUUID();
    await appDb.withTenant(tenantId, async (tx) => {
      const held = await holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity,
        referenceId,
        compatibility: { providerVendor: "arkesel" },
      });
      expect(held.held).toBe(true);
    });
    await appDb.withTenant(tenantId, (tx) =>
      settleTokenHolds(tx, referenceId, "committed"),
    );
  }

  async function balance(tenantId: string, kind: string) {
    const rows = (await owner`
      SELECT balance_minor::text AS balance FROM ledger_accounts
      WHERE tenant_id = ${tenantId}::uuid AND kind = ${kind} AND currency = 'GHS'`) as {
      balance: string;
    }[];
    return BigInt(rows[0]?.balance ?? "0");
  }

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await owner`DELETE FROM token_recognition_allocations WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM token_holds WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM token_lots WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM token_counters WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM token_purchases WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM accounts WHERE id = ${tenantId}::uuid`;
    }
    for (const offerId of offerIds) {
      await owner`DELETE FROM pricing_offer_versions WHERE offer_id = ${offerId}::uuid`;
      await owner`DELETE FROM pricing_offers WHERE id = ${offerId}::uuid`;
    }
    for (const bookId of bookIds) {
      await owner`DELETE FROM price_books WHERE id = ${bookId}::uuid`;
    }
    for (const staffId of staffIds) {
      await owner`DELETE FROM staff_users WHERE id = ${staffId}::uuid`;
    }
    await owner.end();
    await provisioning.end();
    await appDb.sql.end();
  });

  it("allocates indivisible consideration cumulatively and ends at the exact total", async () => {
    const { tenantId, lotId } = await grantBundle(3n, 1n);
    await consume(tenantId, 1n);
    await consume(tenantId, 1n);
    expect(await balance(tenantId, "revenue")).toBe(0n);
    await consume(tenantId, 1n);

    expect(await balance(tenantId, "revenue")).toBe(1n);
    expect(await balance(tenantId, "token_deferred_revenue")).toBe(0n);
    const [lot] = await provisioning.db
      .select()
      .from(tokenLots)
      .where(eq(tokenLots.id, lotId));
    expect(lot).toMatchObject({
      quantityConsumed: 3n,
      revenueRecognizedMinor: 1n,
      totalPriceMinorLocked: 1n,
    });
    const allocations = await provisioning.db
      .select()
      .from(tokenRecognitionAllocations)
      .where(eq(tokenRecognitionAllocations.lotId, lotId));
    expect(allocations.map((row) => row.recognitionMinor).sort()).toEqual([
      0n,
      0n,
      1n,
    ]);
    expect(allocations.filter((row) => row.ledgerTxnId === null)).toHaveLength(
      2,
    );
  });

  it("serializes concurrent settlements and recognizes the full purchase total once", async () => {
    const { tenantId, lotId } = await grantBundle(200n, 300n);
    const references = [randomUUID(), randomUUID()];
    for (const referenceId of references) {
      await appDb.withTenant(tenantId, (tx) =>
        holdTokens(tx, {
          channel: "sms",
          currency: "GHS",
          quantity: 100n,
          referenceId,
          compatibility: { providerVendor: "arkesel" },
        }),
      );
    }
    await Promise.all(
      references.map((referenceId) =>
        appDb.withTenant(tenantId, (tx) =>
          settleTokenHolds(tx, referenceId, "committed"),
        ),
      ),
    );

    const [lot] = await provisioning.db
      .select()
      .from(tokenLots)
      .where(eq(tokenLots.id, lotId));
    expect(lot).toMatchObject({
      quantityConsumed: 200n,
      revenueRecognizedMinor: 300n,
    });
    expect(await balance(tenantId, "revenue")).toBe(300n);
    expect(await balance(tenantId, "token_deferred_revenue")).toBe(0n);
  });

  it("uses fixed bundles only on routes allowed by their purchase snapshot", async () => {
    const { tenantId } = await grantBundle(10n, 10n);
    const incompatible = await appDb.withTenant(tenantId, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 1n,
        referenceId: randomUUID(),
        compatibility: { providerVendor: "another-provider" },
      }),
    );
    expect(incompatible.held).toBe(false);

    const compatible = await appDb.withTenant(tenantId, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 1n,
        referenceId: randomUUID(),
        compatibility: { providerVendor: "arkesel" },
      }),
    );
    expect(compatible.held).toBe(true);
  });

  it("isolates allocation history and rejects a cross-tenant lot reference", async () => {
    const first = await grantBundle(10n, 10n);
    const second = await grantBundle(10n, 10n);
    await consume(first.tenantId, 1n);

    const hidden = await appDb.withTenant(
      second.tenantId,
      (tx) =>
        tx`
        SELECT id FROM token_recognition_allocations
        WHERE lot_id = ${first.lotId}`,
    );
    expect(hidden).toHaveLength(0);
    await expect(
      appDb.withTenant(
        second.tenantId,
        (tx) =>
          tx`
          INSERT INTO token_holds (
            tenant_id, lot_id, channel, currency, quantity, reference_id, idempotency_key
          ) VALUES (
            current_setting('app.tenant_id')::uuid, ${first.lotId}, 'sms', 'GHS',
            1, ${randomUUID()}, ${`cross-tenant-${randomUUID()}`}
          )`,
      ),
    ).rejects.toThrow();
  });
});
