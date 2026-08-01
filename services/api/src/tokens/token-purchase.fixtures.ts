import { randomUUID } from "node:crypto";
import {
  type MinorUnits,
  offerCatalogAssignments,
  type ProvisioningDb,
  priceBooks,
  pricingOffers,
  pricingOfferVersionItems,
  pricingOfferVersions,
  staffUsers,
  type TenantId,
} from "@app/db";
import { eq } from "drizzle-orm";

/** One published single-item SMS package, assigned to the tenant's catalog. */
export async function seedPublishedOffer(
  provisioning: ProvisioningDb,
  track: { bookIds: string[]; offerIds: string[]; staffIds: string[] },
  tenantId: string,
  terms: {
    minimum?: number;
    maximum?: number | null;
    serviceClasses?: string[];
  } = {},
) {
  const [author, approver] = await provisioning.db
    .insert(staffUsers)
    .values([
      { email: `${randomUUID()}@author.test`, role: "admin" },
      { email: `${randomUUID()}@approver.test`, role: "admin" },
    ])
    .returning({ id: staffUsers.id });
  if (!author || !approver) throw new Error("staff fixtures failed");
  track.staffIds.push(author.id, approver.id);

  const [book] = await provisioning.db
    .insert(priceBooks)
    .values({ name: `Bundle ${randomUUID()}`, mode: "token" })
    .returning({ id: priceBooks.id });
  if (!book) throw new Error("book fixture failed");
  track.bookIds.push(book.id);
  const [offer] = await provisioning.db
    .insert(pricingOffers)
    .values({
      priceBookId: book.id,
      code: `bundle-${randomUUID().slice(0, 8)}`,
      name: "200 SMS segments",
      channelCode: "sms",
      unitCode: "segment",
    })
    .returning({ id: pricingOffers.id });
  if (!offer) throw new Error("offer fixture failed");
  track.offerIds.push(offer.id);
  const now = new Date();
  const [version] = await provisioning.db
    .insert(pricingOfferVersions)
    .values({
      offerId: offer.id,
      version: 1,
      status: "draft",
      currency: "GHS",
      paidUnits: 200n,
      bonusUnits: 0n,
      totalUnits: 200n,
      totalPriceMinor: 300n as MinorUnits,
      minimumPackCount: terms.minimum ?? 1,
      maximumPackCount: terms.maximum ?? 10,
      eligibility: {
        providerVendors: ["arkesel"],
        serviceClasses: terms.serviceClasses ?? [],
      },
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
      createdBy: author.id,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    })
    .returning({ id: pricingOfferVersions.id });
  if (!version) throw new Error("version fixture failed");
  // The package's single channel item carries the whole consideration. It must attach while the
  // version is a draft; publishing is what freezes the items.
  await provisioning.db.insert(pricingOfferVersionItems).values({
    offerVersionId: version.id,
    position: 0,
    channelCode: "sms",
    unitCode: "segment",
    paidUnits: 200n,
    totalUnits: 200n,
    eligibility: {
      providerVendors: ["arkesel"],
      serviceClasses: terms.serviceClasses ?? [],
    },
    allocatedPriceMinor: 300n as MinorUnits,
  });
  // Approval moves with the status: pricing_offer_versions_approval_chk forbids an approved draft.
  await provisioning.db
    .update(pricingOfferVersions)
    .set({ status: "published", approvedBy: approver.id, approvedAt: now })
    .where(eq(pricingOfferVersions.id, version.id));
  await provisioning.db.insert(offerCatalogAssignments).values({
    tenantId: tenantId as TenantId,
    priceBookId: book.id,
    assignedBy: approver.id,
    reason: "purchase test",
  });
  return version.id;
}
