import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type MinorUnits,
  priceBooks,
  pricingOffers,
  pricingOfferVersionItems,
  pricingOfferVersions,
  staffUsers,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { grantTokensForPurchase, readTokenBalance } from "./token-grant.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

describeDb("multi-channel package grant and expiry", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 2 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const tenantId = randomUUID();
  const staffId = randomUUID();
  const bookId = randomUUID();
  const offerId = randomUUID();
  const versionId = randomUUID();
  const smsItemId = randomUUID();
  const emailItemId = randomUUID();
  const reference = `token-${randomUUID()}`;

  afterAll(async () => {
    await owner`DELETE FROM token_holds WHERE tenant_id = ${tenantId}::uuid`;
    await owner`DELETE FROM token_recognition_allocations WHERE tenant_id = ${tenantId}::uuid`;
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}::uuid`;
    await owner`DELETE FROM token_lots WHERE tenant_id = ${tenantId}::uuid`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}::uuid`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}::uuid`;
    await owner`DELETE FROM token_counters WHERE tenant_id = ${tenantId}::uuid`;
    await owner`DELETE FROM token_purchases WHERE tenant_id = ${tenantId}::uuid`;
    await owner`DELETE FROM pricing_offer_version_items WHERE offer_version_id = ${versionId}::uuid`;
    await owner`DELETE FROM pricing_offer_versions WHERE id = ${versionId}::uuid`;
    await owner`DELETE FROM pricing_offers WHERE id = ${offerId}::uuid`;
    await owner`DELETE FROM price_books WHERE id = ${bookId}::uuid`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}::uuid`;
    await owner`DELETE FROM staff_users WHERE id = ${staffId}::uuid`;
    await Promise.all([owner.end(), provisioning.end(), appDb.sql.end()]);
  });

  it("grants every item once and recognizes unused allocations as breakage", async () => {
    await provisioning.db.insert(accounts).values({
      id: tenantId as TenantId,
      name: "Package buyer",
      slug: `package-${tenantId}`,
      plan: "growth",
    });
    await provisioning.db.insert(staffUsers).values({
      id: staffId,
      email: `${staffId}@package.test`,
      role: "admin",
    });
    await provisioning.db.insert(priceBooks).values({
      id: bookId,
      name: "Package test",
      mode: "token",
    });
    await provisioning.db.insert(pricingOffers).values({
      id: offerId,
      priceBookId: bookId,
      code: "sms-email-20",
      name: "SMS and email",
    });
    await provisioning.db.insert(pricingOfferVersions).values({
      id: versionId,
      offerId,
      version: 1,
      currency: "GHS",
      paidUnits: 40n,
      totalUnits: 40n,
      totalPriceMinor: 500n as MinorUnits,
      creditValidityDays: 1,
      createdBy: staffId,
    });
    await provisioning.db.insert(pricingOfferVersionItems).values([
      {
        id: smsItemId,
        offerVersionId: versionId,
        position: 0,
        channelCode: "sms",
        unitCode: "segment",
        paidUnits: 20n,
        totalUnits: 20n,
        allocatedPriceMinor: 300n as MinorUnits,
      },
      {
        id: emailItemId,
        offerVersionId: versionId,
        position: 1,
        channelCode: "email",
        unitCode: "message",
        paidUnits: 20n,
        totalUnits: 20n,
        allocatedPriceMinor: 200n as MinorUnits,
      },
    ]);
    await provisioning.db.insert(tokenPurchases).values({
      tenantId: tenantId as TenantId,
      reference,
      offerVersionId: versionId,
      packCount: 2,
      pricePerPackMinorLocked: 500n as MinorUnits,
      offerSnapshot: {
        offerCode: "sms-email-20",
        offerName: "SMS and email",
        offerVersion: 1,
        totalPriceMinor: "500",
        creditValidityDays: 1,
        items: [
          {
            itemId: smsItemId,
            channelCode: "sms",
            unitCode: "segment",
            paidUnits: "20",
            bonusUnits: "0",
            totalUnits: "20",
            allocatedPriceMinor: "300",
            eligibility: {},
          },
          {
            itemId: emailItemId,
            channelCode: "email",
            unitCode: "message",
            paidUnits: "20",
            bonusUnits: "0",
            totalUnits: "20",
            allocatedPriceMinor: "200",
            eligibility: {},
          },
        ],
      },
      currency: "GHS",
      amountMinor: 1_000n as MinorUnits,
      email: "buyer@example.com",
    });

    const first = await grantTokensForPurchase(
      { provisioning, appDb },
      reference,
    );
    const replay = await grantTokensForPurchase(
      { provisioning, appDb },
      reference,
    );
    expect(first.lots.map((lot) => [lot.channel, lot.quantity])).toEqual([
      ["sms", 40n],
      ["email", 40n],
    ]);
    expect(replay.granted).toBe(false);
    expect(replay.lots.map((lot) => lot.lotId)).toEqual(
      first.lots.map((lot) => lot.lotId),
    );

    await owner`
      UPDATE token_lots SET expires_at = now() - interval '1 minute'
      WHERE tenant_id = ${tenantId}::uuid`;
    const balances = await appDb.withTenant(tenantId, async (tx) => ({
      sms: await readTokenBalance(tx, "sms", "GHS"),
      email: await readTokenBalance(tx, "email", "GHS"),
    }));
    expect(balances).toEqual({ sms: 0n, email: 0n });

    const breakage = (await owner`
      SELECT COALESCE(sum(e.amount_minor), 0)::text AS amount
      FROM ledger_entries e
      JOIN ledger_transactions t ON t.id = e.txn_id
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE e.tenant_id = ${tenantId}::uuid
        AND t.type = 'token_breakage' AND a.kind = 'revenue'
        AND e.direction = 'credit'`) as Array<{ amount: string }>;
    expect(breakage[0]?.amount).toBe("1000");
  });
});
