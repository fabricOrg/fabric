import { randomUUID } from "node:crypto";
import {
  auditEvents,
  createProvisioningDb,
  pricingOfferVersions,
  staffUsers,
} from "@app/db";
import { eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import { CommercialOfferMarginService } from "./commercial-offer-margin.service.js";
import { CommercialOfferPublishService } from "./commercial-offer-publish.service.js";
import {
  makeOfferFixtures,
  type OfferFixtures,
  versionRequest,
} from "./commercial-offers.fixtures.js";
import { CommercialOffersService } from "./commercial-offers.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

/**
 * Concurrency and attribution around publication — split from `commercial-offers.integration.spec.ts`
 * because these tests are about WHO published and WHETHER THE TERMS MOVED, not about the gate's verdict.
 *
 * The interesting one drives a real race deterministically rather than hoping for a scheduling window.
 */
describeDb("commercial offer publication — concurrency and attribution", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const margin = new CommercialOfferMarginService(db);
  const offers = new CommercialOffersService(db, new AuditService(db), margin);
  const publishing = new CommercialOfferPublishService(
    db,
    new AuditService(db),
    margin,
  );
  const fixtures: OfferFixtures = makeOfferFixtures(db);

  afterAll(async () => {
    await fixtures.cleanup();
    await db.db
      .delete(auditEvents)
      .where(like(auditEvents.action, "commercial_offer.%"));
    await db.end();
  });

  it("refuses to publish terms that changed after the margin was checked", async () => {
    // The gate evaluates the draft as READ, and publishing rewrites only lifecycle columns. Without the
    // re-read + `offerTermsUnchanged` comparison inside the transaction, an edit landing in that window
    // would be published carrying a cost snapshot describing different terms — a price no gate approved.
    // (A `WHERE updated_at = $1` predicate cannot do this job; see the comment on `offerTermsUnchanged`.)
    const author = await fixtures.staff();
    const approver = await fixtures.staff();
    const offer = await fixtures.offer(author);
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

    // Drive the race deterministically: the margin check is the window, so a stub that edits the row
    // WHILE evaluating reproduces "verified terms A, about to publish terms B" exactly. It returns the
    // genuine verdict for the pre-edit terms, which is what makes this the dangerous case rather than
    // an obviously-invalid one.
    const racingMargin = {
      async evaluate(terms: Parameters<typeof margin.evaluate>[0]) {
        const verdict = await margin.evaluate(terms);
        await offers.updateVersion(
          draft.id,
          { ...versionRequest(eligibility), total_price_minor: "60" },
          author,
        );
        return verdict;
      },
    } as CommercialOfferMarginService;
    const racingPublisher = new CommercialOfferPublishService(
      db,
      new AuditService(db),
      racingMargin,
    );

    await expect(
      racingPublisher.publish(draft.id, { reason: "stale terms" }, approver),
    ).rejects.toMatchObject({
      response: { error: { code: "offer_version_changed" } },
    });

    const [row] = await db.db
      .select({ status: pricingOfferVersions.status })
      .from(pricingOfferVersions)
      .where(eq(pricingOfferVersions.id, draft.id))
      .limit(1);
    expect(row?.status).toBe("draft");
  });

  it("refuses a publish attributed to an unknown staff member", async () => {
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
    await expect(
      publishing.publish(
        draft.id,
        { reason: "ghost" },
        { email: "ghost@fabric.dev", staffId: randomUUID() },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "staff_actor_unknown" } },
    });
    const [stillDraft] = await db.db
      .select({ status: pricingOfferVersions.status })
      .from(pricingOfferVersions)
      .where(eq(pricingOfferVersions.id, draft.id))
      .limit(1);
    expect(stillDraft?.status).toBe("draft");
  });

  it("records the author by id and refuses to erase the approval trail", async () => {
    const author = await fixtures.staff();
    const offer = await fixtures.offer(author);
    const draft = await offers.createVersion(
      offer.id,
      versionRequest({ provider_vendors: [`x-${randomUUID().slice(0, 8)}`] }),
      author,
    );
    expect(draft.created_by_email).toBe(author.email);
    expect(draft.created_by).toBe(author.staffId);
    const [row] = await db.db
      .select({ createdBy: pricingOfferVersions.createdBy })
      .from(pricingOfferVersions)
      .where(eq(pricingOfferVersions.id, draft.id))
      .limit(1);
    // The id is the record; the email is a lookup. Deleting the staff row is REFUSED (ON DELETE
    // RESTRICT) precisely so the approval trail cannot be erased.
    await expect(
      db.db.delete(staffUsers).where(eq(staffUsers.id, row?.createdBy ?? "")),
    ).rejects.toThrow();
  });
});
