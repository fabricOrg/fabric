import { randomUUID } from "node:crypto";
import {
  commercialOfferChannels,
  type MinorUnits,
  type ProvisioningDb,
  priceBooks,
  pricingOffers,
  pricingOfferVersionItems,
  pricingOfferVersions,
  staffUsers,
  type TenantId,
  type TokenOfferSnapshot,
  tokenPurchases,
} from "@app/db";
import { eq } from "drizzle-orm";
import type { Sql } from "postgres";

/** Ids the caller must delete, in this order, before its price books and staff rows. */
export interface PackageTrack {
  bookIds: string[];
  offerIds: string[];
  staffIds: string[];
}

/**
 * A published single-channel package, the cheapest lawful way to obtain a token lot.
 *
 * Every lot descends from a published offer item — there is no ad-hoc or unit-priced lot any more —
 * so a fixture that just wants "some tokens" still has to go through offer → version → item →
 * publish. That is the point: the shape a test can create is the shape production can create.
 */
export async function seedPackageVersion(
  provisioning: ProvisioningDb,
  track: PackageTrack,
  spec: {
    channel?: string | undefined;
    unitCode?: string | undefined;
    totalUnits: bigint;
    totalPriceMinor: bigint;
    creditValidityDays?: number | null | undefined;
    eligibility?: Record<string, unknown> | undefined;
  },
): Promise<{
  versionId: string;
  itemId: string;
  priceBookId: string;
  unitCode: string;
}> {
  const channel = spec.channel ?? "sms";
  // Resolve the natural unit from the registry: (channel, unit) is a foreign key, so defaulting to
  // "segment" would break the moment a fixture asks for email.
  const [registered] = await provisioning.db
    .select({ unitCode: commercialOfferChannels.unitCode })
    .from(commercialOfferChannels)
    .where(eq(commercialOfferChannels.code, channel))
    .limit(1);
  const unitCode = spec.unitCode ?? registered?.unitCode;
  if (!unitCode) {
    throw new Error(`no registered unit for channel ${channel}`);
  }
  // Unrestricted by default: these fixtures exist to exercise holds, recognition and expiry, not
  // routing. A spec that cares about eligibility passes it explicitly.
  const eligibility = spec.eligibility ?? {};

  const [author, approver] = await provisioning.db
    .insert(staffUsers)
    .values([
      { email: `${randomUUID()}@author.test`, role: "admin" },
      { email: `${randomUUID()}@approver.test`, role: "admin" },
    ])
    .returning({ id: staffUsers.id });
  if (!author || !approver) throw new Error("staff fixture failed");
  track.staffIds.push(author.id, approver.id);

  const [book] = await provisioning.db
    .insert(priceBooks)
    .values({ name: `Package ${randomUUID()}`, mode: "token" })
    .returning({ id: priceBooks.id });
  if (!book) throw new Error("price book fixture failed");
  track.bookIds.push(book.id);

  const [offer] = await provisioning.db
    .insert(pricingOffers)
    .values({
      priceBookId: book.id,
      code: `pkg-${randomUUID().slice(0, 8)}`,
      name: "Fixture package",
      channelCode: channel,
      unitCode,
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
      paidUnits: spec.totalUnits,
      bonusUnits: 0n,
      totalUnits: spec.totalUnits,
      totalPriceMinor: spec.totalPriceMinor as MinorUnits,
      creditValidityDays: spec.creditValidityDays ?? null,
      eligibility,
      costSnapshot: {
        bestCaseCostMinor: "0",
        worstCaseCostMinor: "0",
        bestCaseMarginMinor: spec.totalPriceMinor.toString(),
        worstCaseMarginMinor: spec.totalPriceMinor.toString(),
        worstCaseMarginBps: 10_000,
        minimumMarginBps: 0,
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

  // Items attach while the version is a draft; publishing freezes them, and approval must move with
  // the status because pricing_offer_versions_approval_chk forbids an approved draft.
  const [item] = await provisioning.db
    .insert(pricingOfferVersionItems)
    .values({
      offerVersionId: version.id,
      position: 0,
      channelCode: channel,
      unitCode,
      paidUnits: spec.totalUnits,
      totalUnits: spec.totalUnits,
      eligibility,
      allocatedPriceMinor: spec.totalPriceMinor as MinorUnits,
    })
    .returning({ id: pricingOfferVersionItems.id });
  if (!item) throw new Error("version item fixture failed");
  await provisioning.db
    .update(pricingOfferVersions)
    .set({ status: "published", approvedBy: approver.id, approvedAt: now })
    .where(eq(pricingOfferVersions.id, version.id));

  return {
    versionId: version.id,
    itemId: item.id,
    priceBookId: book.id,
    unitCode,
  };
}

/** A cleared-shape purchase row for a seeded package, ready for `grantTokensForPurchase`. */
export async function seedPackagePurchase(
  provisioning: ProvisioningDb,
  track: PackageTrack,
  spec: {
    tenantId: string;
    channel?: string;
    unitCode?: string;
    quantity: bigint;
    totalPriceMinor: bigint;
    packCount?: number;
    creditValidityDays?: number | null;
    eligibility?: Record<string, unknown>;
  },
): Promise<{ reference: string; versionId: string; itemId: string }> {
  const packCount = spec.packCount ?? 1;
  const perPackUnits = spec.quantity / BigInt(packCount);
  const perPackPrice = spec.totalPriceMinor / BigInt(packCount);
  const { versionId, itemId, unitCode } = await seedPackageVersion(
    provisioning,
    track,
    {
      channel: spec.channel,
      unitCode: spec.unitCode,
      totalUnits: perPackUnits,
      totalPriceMinor: perPackPrice,
      creditValidityDays: spec.creditValidityDays,
      eligibility: spec.eligibility,
    },
  );

  const snapshot: TokenOfferSnapshot = {
    offerCode: "pkg-fixture",
    offerName: "Fixture package",
    offerVersion: 1,
    totalPriceMinor: perPackPrice.toString(),
    creditValidityDays: spec.creditValidityDays ?? null,
    items: [
      {
        itemId,
        channelCode: spec.channel ?? "sms",
        unitCode,
        paidUnits: perPackUnits.toString(),
        bonusUnits: "0",
        totalUnits: perPackUnits.toString(),
        allocatedPriceMinor: perPackPrice.toString(),
        eligibility: (spec.eligibility ??
          {}) as TokenOfferSnapshot["items"][number]["eligibility"],
      },
    ],
  };

  const reference = `token-${randomUUID()}`;
  await provisioning.db.insert(tokenPurchases).values({
    tenantId: spec.tenantId as TenantId,
    reference,
    offerVersionId: versionId,
    packCount,
    pricePerPackMinorLocked: perPackPrice as MinorUnits,
    offerSnapshot: snapshot,
    currency: "GHS",
    amountMinor: spec.totalPriceMinor as MinorUnits,
    email: "buyer@example.com",
  });
  return { reference, versionId, itemId };
}

/**
 * Remove everything `seedPackageVersion` created, in FK order: items before versions (the FK is ON
 * DELETE RESTRICT), versions before offers, offers before books, staff last because created_by and
 * approved_by are restricting references too.
 */
export async function cleanupPackages(
  owner: Sql,
  track: PackageTrack,
): Promise<void> {
  for (const offerId of track.offerIds) {
    await owner`
      DELETE FROM pricing_offer_version_items
      WHERE offer_version_id IN (
        SELECT id FROM pricing_offer_versions WHERE offer_id = ${offerId}::uuid
      )`;
    await owner`DELETE FROM pricing_offer_versions WHERE offer_id = ${offerId}::uuid`;
    await owner`DELETE FROM pricing_offers WHERE id = ${offerId}::uuid`;
  }
  for (const bookId of track.bookIds) {
    await owner`DELETE FROM price_books WHERE id = ${bookId}::uuid`;
  }
  for (const staffId of track.staffIds) {
    await owner`DELETE FROM staff_users WHERE id = ${staffId}::uuid`;
  }
}
