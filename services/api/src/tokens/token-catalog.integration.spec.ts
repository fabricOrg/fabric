import { randomUUID } from "node:crypto";
import {
  accounts,
  createProvisioningDb,
  type MinorUnits,
  offerCatalogAssignments,
  priceBooks,
  pricingOffers,
  pricingOfferVersions,
  staffUsers,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TokenCatalogService } from "./token-catalog.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

describeDb("customer commercial-offer catalog", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const service = new TokenCatalogService(provisioning);
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const staffId = randomUUID();
  const approverId = randomUUID();
  const bookId = randomUUID();
  const offerId = randomUUID();
  const versionId = randomUUID();
  const reference = `catalog-${randomUUID()}`;

  beforeAll(async () => {
    await provisioning.db.insert(accounts).values([
      {
        id: tenantId as TenantId,
        name: "Catalog tenant",
        slug: `catalog-${tenantId}`,
        billingCurrency: "GHS",
        plan: "growth",
      },
      {
        id: otherTenantId as TenantId,
        name: "Other tenant",
        slug: `catalog-${otherTenantId}`,
        billingCurrency: "GHS",
        plan: "growth",
      },
    ]);
    await provisioning.db.insert(staffUsers).values([
      {
        id: staffId,
        email: `${staffId}@catalog.test`,
        role: "admin",
      },
      {
        id: approverId,
        email: `${approverId}@catalog.test`,
        role: "admin",
      },
    ]);
    await provisioning.db.insert(priceBooks).values({
      id: bookId,
      name: "Ghana prepaid",
      mode: "token",
    });
    await provisioning.db.insert(pricingOffers).values({
      id: offerId,
      priceBookId: bookId,
      code: "sms-200",
      name: "200 SMS segments",
      description: "Ghana transactional SMS",
      channelCode: "sms",
      unitCode: "segment",
    });
    const now = new Date("2026-01-01T00:00:00.000Z");
    await provisioning.db.insert(pricingOfferVersions).values({
      id: versionId,
      offerId,
      version: 1,
      status: "published",
      currency: "GHS",
      paidUnits: 200n,
      bonusUnits: 0n,
      totalUnits: 200n,
      totalPriceMinor: 300n as MinorUnits,
      minimumPackCount: 1,
      maximumPackCount: 10,
      eligibility: { providerVendors: ["arkesel"] },
      costSnapshot: {
        bestCaseCostMinor: "100",
        worstCaseCostMinor: "120",
        bestCaseMarginMinor: "200",
        worstCaseMarginMinor: "180",
        worstCaseMarginBps: 6_000,
        minimumMarginBps: 2_000,
        minimumMarginSource: "platform_default",
        routeCount: 1,
        calculatedAt: now.toISOString(),
        sourceReferences: ["fixture"],
      },
      createdBy: staffId,
      approvedBy: approverId,
      approvedAt: now,
      effectiveFrom: now,
    });
    await provisioning.db.insert(offerCatalogAssignments).values({
      tenantId: tenantId as TenantId,
      priceBookId: bookId,
      assignedBy: staffId,
      reason: "catalog read test",
    });
    await provisioning.db.insert(tokenPurchases).values({
      tenantId: tenantId as TenantId,
      reference,
      providerMode: "sandbox",
      pricingModel: "fixed_bundle",
      offerVersionId: versionId,
      packCount: 2,
      unitsPerPackLocked: 200n,
      pricePerPackMinorLocked: 300n as MinorUnits,
      offerSnapshot: {
        offerCode: "sms-200",
        offerName: "200 SMS segments",
        offerVersion: 1,
        channelCode: "sms",
        unitCode: "segment",
        paidUnits: "200",
        bonusUnits: "0",
        totalUnits: "200",
        totalPriceMinor: "300",
        eligibility: { providerVendors: ["arkesel"] },
      },
      channel: "sms",
      quantity: 400n,
      currency: "GHS",
      amountMinor: 600n as MinorUnits,
      email: "buyer@example.com",
    });
  });

  afterAll(async () => {
    await owner`DELETE FROM token_purchases WHERE reference = ${reference}`;
    await owner`DELETE FROM offer_catalog_assignments WHERE tenant_id = ${tenantId}::uuid`;
    await owner`DELETE FROM pricing_offer_versions WHERE id = ${versionId}::uuid`;
    await owner`DELETE FROM pricing_offers WHERE id = ${offerId}::uuid`;
    await owner`DELETE FROM price_books WHERE id = ${bookId}::uuid`;
    await owner`DELETE FROM accounts WHERE id IN (${tenantId}::uuid, ${otherTenantId}::uuid)`;
    await owner`DELETE FROM staff_users WHERE id IN (${staffId}::uuid, ${approverId}::uuid)`;
    await owner.end();
    await provisioning.end();
  });

  it("returns only customer-safe published terms from the assigned catalog", async () => {
    expect(await service.catalog(tenantId)).toEqual({
      catalog_name: "Ghana prepaid",
      offers: [
        expect.objectContaining({
          offer_version_id: versionId,
          channel_code: "sms",
          unit_code: "segment",
          total_units: "200",
          total_price_minor: "300",
          eligibility: expect.objectContaining({
            provider_vendors: ["arkesel"],
          }),
        }),
      ],
    });
  });

  it("contains an immutable receipt read to its tenant", async () => {
    expect(await service.receipt(tenantId, reference)).toMatchObject({
      reference,
      status: "pending",
      offer_version_id: versionId,
      quantity: "400",
      amount_minor: "600",
    });
    await expect(
      service.receipt(otherTenantId, reference),
    ).rejects.toMatchObject({
      response: { error: { code: "token_purchase_not_found" } },
    });
  });
});
