import { randomUUID } from "node:crypto";
import {
  auditEvents,
  createProvisioningDb,
  offerCatalogAssignments,
  priceBooks,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import { CommercialOfferMarginService } from "./commercial-offer-margin.service.js";
import { resolveOfferCatalogId } from "./commercial-offer-reads.js";
import {
  makeOfferFixtures,
  type OfferFixtures,
  rejectionText,
} from "./commercial-offers.fixtures.js";
import { CommercialOffersService } from "./commercial-offers.service.js";
import { OfferCatalogService } from "./offer-catalog.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

/**
 * COM-011 — which catalog a workspace buys from. The interesting cases are the ones the database
 * refuses on its own: a pay-as-you-go book assigned as a prepaid catalog, and a catalog's mode being
 * changed out from under an assignment that depends on it.
 */
describeDb("workspace offer catalog assignment", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const offers = new CommercialOffersService(
    db,
    new AuditService(db),
    new CommercialOfferMarginService(db),
    { get: () => undefined } as unknown as ConfigService,
  );
  const catalogs = new OfferCatalogService(db, new AuditService(db));
  const fixtures: OfferFixtures = makeOfferFixtures(db);

  afterAll(async () => {
    await fixtures.cleanup();
    await db.db
      .delete(auditEvents)
      .where(like(auditEvents.action, "commercial_offer.%"));
    await db.end();
  });

  it("resolves the assigned catalog, then falls back once it is cleared", async () => {
    const staff = await fixtures.staff();
    const tenantId = await fixtures.account();
    const negotiated = await fixtures.book("token");

    const before = await resolveOfferCatalogId(db.db, tenantId);
    // Unassigned resolves to the platform's default token book — or null where none is configured.
    expect(before === null || before !== negotiated).toBe(true);

    await catalogs.assign(
      tenantId,
      {
        offer_catalog_id: negotiated,
        reason: "Partner pricing agreed 2026-07",
      },
      staff,
    );
    expect(await resolveOfferCatalogId(db.db, tenantId)).toBe(negotiated);

    const [assignment] = await db.db
      .select({
        assignedBy: offerCatalogAssignments.assignedBy,
        reason: offerCatalogAssignments.reason,
      })
      .from(offerCatalogAssignments)
      .where(eq(offerCatalogAssignments.tenantId, tenantId as never))
      .limit(1);
    expect(assignment?.assignedBy).toBe(staff.staffId);
    expect(assignment?.reason).toContain("Partner pricing");

    // Re-assigning replaces rather than duplicating: one catalog per workspace is the primary key.
    const second = await fixtures.book("token");
    await catalogs.assign(
      tenantId,
      { offer_catalog_id: second, reason: "" },
      staff,
    );
    expect(await resolveOfferCatalogId(db.db, tenantId)).toBe(second);

    await catalogs.assign(
      tenantId,
      { offer_catalog_id: null, reason: "back to standard" },
      staff,
    );
    const rows = await db.db
      .select({ tenantId: offerCatalogAssignments.tenantId })
      .from(offerCatalogAssignments)
      .where(eq(offerCatalogAssignments.tenantId, tenantId as never));
    expect(rows).toHaveLength(0);

    const audited = await db.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.targetId, tenantId));
    expect(
      audited.filter((row) => row.action === "commercial_offer.assign_catalog")
        .length,
    ).toBe(3);
  });

  it("refuses a pay-as-you-go book as a prepaid catalog, in the service AND the database", async () => {
    const staff = await fixtures.staff();
    const tenantId = await fixtures.account();
    const subscription = await fixtures.book("subscription");

    await expect(
      catalogs.assign(
        tenantId,
        { offer_catalog_id: subscription, reason: "" },
        staff,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "offer_catalog_invalid_mode" } },
    });

    // The trigger is the real boundary — a fixture or future code path that skips the service is
    // refused just the same.
    expect(
      await rejectionText(
        db.db.insert(offerCatalogAssignments).values({
          tenantId: tenantId as never,
          priceBookId: subscription,
          assignedBy: staff.staffId,
        }),
      ),
    ).toMatch(/token-mode catalogs/);
  });

  it("refuses an unknown catalog id without leaving a partial assignment", async () => {
    const staff = await fixtures.staff();
    const tenantId = await fixtures.account();
    await expect(
      catalogs.assign(
        tenantId,
        { offer_catalog_id: randomUUID(), reason: "" },
        staff,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "price_book_not_found" } },
    });
    const rows = await db.db
      .select({ tenantId: offerCatalogAssignments.tenantId })
      .from(offerCatalogAssignments)
      .where(eq(offerCatalogAssignments.tenantId, tenantId as never));
    expect(rows).toHaveLength(0);
  });

  it("refuses to change a catalog's mode while a workspace or an offer depends on it", async () => {
    const staff = await fixtures.staff();
    const tenantId = await fixtures.account();
    const catalog = await fixtures.book("token");
    await catalogs.assign(
      tenantId,
      { offer_catalog_id: catalog, reason: "" },
      staff,
    );

    expect(
      await rejectionText(
        db.db
          .update(priceBooks)
          .set({ mode: "subscription" })
          .where(eq(priceBooks.id, catalog)),
      ),
    ).toMatch(/assigned as a workspace catalog/);

    // Same protection from the offers side: an offer's catalog cannot stop being a token book either.
    const author = await fixtures.staff();
    const offer = await fixtures.offer(author);
    expect(
      await rejectionText(
        db.db
          .update(priceBooks)
          .set({ mode: "subscription" })
          .where(eq(priceBooks.id, offer.price_book_id)),
      ),
    ).toMatch(/holds commercial offers/);
  });

  it("lists offers with their catalog name and the channel registry", async () => {
    const author = await fixtures.staff();
    const offer = await fixtures.offer(author);
    const listed = await offers.list();

    const found = listed.offers.find((row) => row.id === offer.id);
    expect(found?.catalog_name).toContain("Offers token");
    expect(found?.versions).toEqual([]);
    // SMS/segment and email/recipient ship active; anything else must be registered before use.
    expect(
      listed.channels.some(
        (channel) =>
          channel.code === "sms" &&
          channel.unit_code === "segment" &&
          channel.is_active,
      ),
    ).toBe(true);
  });
});
