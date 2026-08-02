import { randomUUID } from "node:crypto";
import {
  auditEvents,
  createProvisioningDb,
  pricingOfferVersions,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import { CommercialOfferMarginService } from "./commercial-offer-margin.service.js";
import { CommercialOfferPublishService } from "./commercial-offer-publish.service.js";
import {
  makeOfferFixtures,
  type OfferFixtures,
  rejectionText,
  versionRequest,
} from "./commercial-offers.fixtures.js";
import { CommercialOffersService } from "./commercial-offers.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

/**
 * Real-Postgres coverage for the COM-003 publish gate. The assertions that matter are the REFUSALS:
 * a margin floor that only holds in a unit test does not protect any money.
 */
describeDb("commercial offer publication", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const margin = new CommercialOfferMarginService(db);
  const offers = new CommercialOffersService(db, new AuditService(db), margin, {
    get: () => undefined,
  } as unknown as ConfigService);
  // Separation of duties ON: this suite asserts the author's own publish is refused.
  const publishing = new CommercialOfferPublishService(
    db,
    new AuditService(db),
    margin,
    { get: () => undefined } as unknown as ConfigService,
  );
  const fixtures: OfferFixtures = makeOfferFixtures(db);

  afterAll(async () => {
    await fixtures.cleanup();
    await db.db
      .delete(auditEvents)
      .where(like(auditEvents.action, "commercial_offer.%"));
    await db.end();
  });

  it("refuses an offer in a pay-as-you-go catalog and an unregistered channel", async () => {
    const author = await fixtures.staff();
    const subscriptionBook = await fixtures.book("subscription");
    await expect(
      offers.createOffer(
        {
          price_book_id: subscriptionBook,
          code: `sub-${randomUUID().slice(0, 8)}`,
          name: "Wrong catalog",
          description: "",
        },
        author,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "offer_catalog_invalid_mode" } },
    });

    const tokenBook = await fixtures.book("token");
    const offer = await offers.createOffer(
      {
        price_book_id: tokenBook,
        code: `voice-${randomUUID().slice(0, 8)}`,
        name: "Unregistered channel",
        description: "",
      },
      author,
    );
    fixtures.trackOffer(offer.id);
    await expect(
      offers.createVersion(
        offer.id,
        {
          ...versionRequest(),
          items: [
            {
              channel_code: "voice",
              unit_code: "second",
              paid_units: "200",
              bonus_units: "0",
              eligibility: {
                destination_countries: [],
                traffic_classes: [],
                provider_vendors: [],
                service_classes: [],
              },
            },
          ],
        },
        author,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "commercial_channel_not_registered" } },
    });
  });

  it("refuses publication without provider-cost evidence for a permitted route", async () => {
    const author = await fixtures.staff();
    const approver = await fixtures.staff();
    const offer = await fixtures.offer(author);
    // A vendor with no rates at all: nothing prices this route, so the gate must not pass it.
    const draft = await offers.createVersion(
      offer.id,
      versionRequest({
        provider_vendors: [`unpriced-${randomUUID().slice(0, 8)}`],
        destination_countries: ["GH"],
        traffic_classes: ["transactional"],
      }),
      author,
    );
    await expect(
      publishing.publish(draft.id, { reason: "no cost basis" }, approver),
    ).rejects.toMatchObject({
      response: { error: { code: "offer_cost_basis_missing" } },
    });
  });

  it("refuses publication when the worst permitted route breaches the floor", async () => {
    const author = await fixtures.staff();
    const approver = await fixtures.staff();
    const offer = await fixtures.offer(author);
    // 200 segments at 2 pesewas each = GHS 4.00 of cost against a GHS 3.00 price.
    const vendor = await fixtures.costRate({ numerator: 2n, denominator: 1n });
    const draft = await offers.createVersion(
      offer.id,
      versionRequest({
        provider_vendors: [vendor],
        destination_countries: ["GH"],
        traffic_classes: ["transactional"],
      }),
      author,
    );

    const preview = await offers.preview({
      offer_id: offer.id,
      ...versionRequest({
        provider_vendors: [vendor],
        destination_countries: ["GH"],
        traffic_classes: ["transactional"],
      }),
    });
    expect(preview.publishable).toBe(false);
    expect(preview.blocked_reason).toBe("offer_margin_below_floor");
    expect(preview.routes[0]?.total_cost_minor).toBe("400");
    expect(preview.items[0]?.allocated_price_minor).toBe("300");

    await expect(
      publishing.publish(draft.id, { reason: "below cost" }, approver),
    ).rejects.toMatchObject({
      response: { error: { code: "offer_margin_below_floor" } },
    });
  });

  it("refuses the author's own publication, then records the second actor's approval", async () => {
    const author = await fixtures.staff();
    const approver = await fixtures.staff();
    const offer = await fixtures.offer(author);
    // 0.5 pesewas per segment → GHS 1.00 cost on a GHS 3.00 bundle, comfortably above the floor.
    const vendor = await fixtures.costRate({ numerator: 1n, denominator: 2n });
    const eligibility = {
      provider_vendors: [vendor],
      destination_countries: ["GH"],
      traffic_classes: ["transactional"],
    };
    const draft = await offers.createVersion(
      offer.id,
      versionRequest(eligibility),
      author,
    );

    await expect(
      publishing.publish(draft.id, { reason: "self" }, author),
    ).rejects.toMatchObject({
      response: { error: { code: "offer_publish_self_approval" } },
    });

    const published = await publishing.publish(
      draft.id,
      { reason: "Margin verified against the fixture rate." },
      approver,
    );
    expect(published.status).toBe("published");
    expect(published.approved_by).toBe(approver.staffId);
    expect(published.approved_by_email).toBe(approver.email);
    expect(published.cost_snapshot?.worst_case_cost_minor).toBe("100");
    expect(published.cost_snapshot?.minimum_margin_source).toBe(
      "platform_default",
    );
    expect(published.cost_snapshot?.route_count).toBe(1);

    // Filter by ACTION: the draft-authoring event shares this target id, and it is attributed to the
    // author — matching it here would assert the opposite of what this test is about.
    const [audited] = await db.db
      .select({ reason: auditEvents.reason, actor: auditEvents.actorStaffId })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, draft.id),
          eq(auditEvents.action, "commercial_offer.publish"),
        ),
      )
      .limit(1);
    expect(audited?.actor).toBe(approver.staffId);
    expect(audited?.reason).toContain("Margin verified");

    // Published terms are immutable — the service refuses, and so does the 0110 trigger underneath it.
    await expect(
      offers.updateVersion(draft.id, versionRequest(eligibility), author),
    ).rejects.toMatchObject({
      response: { error: { code: "offer_version_not_draft" } },
    });
    expect(
      await rejectionText(
        db.db
          .update(pricingOfferVersions)
          .set({ totalPriceMinor: 1n as never })
          .where(eq(pricingOfferVersions.id, draft.id)),
      ),
    ).toMatch(/published pricing offer versions are immutable/);
  });

  it("refuses a second version effective over the same window, then allows a closed one", async () => {
    const author = await fixtures.staff();
    const approver = await fixtures.staff();
    const offer = await fixtures.offer(author);
    const vendor = await fixtures.costRate({ numerator: 1n, denominator: 2n });
    const eligibility = {
      provider_vendors: [vendor],
      destination_countries: ["GH"],
      traffic_classes: ["transactional"],
    };
    const first = await offers.createVersion(
      offer.id,
      versionRequest(eligibility),
      author,
    );
    await publishing.publish(first.id, { reason: "first" }, approver);

    const overlapping = await offers.createVersion(
      offer.id,
      versionRequest(eligibility),
      author,
    );
    await expect(
      publishing.publish(overlapping.id, { reason: "overlap" }, approver),
    ).rejects.toMatchObject({
      response: { error: { code: "offer_version_window_conflict" } },
    });

    // A version whose window opens after the first one closes is fine; the first is open-ended here,
    // so retire it and publish a successor that starts later.
    const retired = await publishing.retire(
      first.id,
      { reason: "superseded" },
      approver,
    );
    expect(retired.status).toBe("retired");
    expect(retired.total_price_minor).toBe(first.total_price_minor);
    expect(retired.approved_by).toBe(approver.staffId);

    const successor = await offers.cloneVersion(first.id, author);
    expect(successor.status).toBe("draft");
    expect(successor.version).toBe(3);
    const live = await publishing.publish(
      successor.id,
      { reason: "successor" },
      approver,
    );
    expect(live.status).toBe("published");
  });

  it("lets a solo deployment self-approve, but only with a recorded reason", async () => {
    // A single-operator install has no second admin. The policy permits it; the DATABASE still
    // refuses a silent self-approval, so the reason is the approval record.
    const solo = new CommercialOfferPublishService(
      db,
      new AuditService(db),
      margin,
      {
        get: (key: string) =>
          key === "PRICING_SELF_APPROVAL_ENABLED" ? "true" : undefined,
      } as unknown as ConfigService,
    );
    const author = await fixtures.staff();
    const offer = await fixtures.offer(author);
    const vendor = await fixtures.costRate({ numerator: 1n, denominator: 2n });
    const draft = await offers.createVersion(
      offer.id,
      versionRequest({
        provider_vendors: [vendor],
        destination_countries: ["GH"],
        traffic_classes: ["transactional"],
      }),
      author,
    );

    const published = await solo.publish(
      draft.id,
      { reason: "Sole operator; margin checked against the fixture rate." },
      author,
    );
    expect(published.status).toBe("published");
    expect(published.approved_by).toBe(author.staffId);

    // The justification is persisted on the version, not just in the audit log.
    const [row] = await db.db
      .select({ reason: pricingOfferVersions.selfApprovalReason })
      .from(pricingOfferVersions)
      .where(eq(pricingOfferVersions.id, draft.id))
      .limit(1);
    expect(row?.reason).toContain("Sole operator");
  });
});
