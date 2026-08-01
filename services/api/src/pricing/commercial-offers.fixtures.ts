import { randomUUID } from "node:crypto";
import type {
  CommercialOfferDto,
  CreateCommercialOfferVersionRequest,
} from "@app/contracts";
import {
  accounts,
  type MinorUnits,
  offerCatalogAssignments,
  type ProvisioningDb,
  priceBooks,
  pricingOffers,
  pricingOfferVersions,
  providerCostRates,
  staffUsers,
  type TenantId,
} from "@app/db";
import { eq, inArray } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { CommercialOfferMarginService } from "./commercial-offer-margin.service.js";
import type { StaffActor } from "./commercial-offers.service.js";
import { CommercialOffersService } from "./commercial-offers.service.js";

/**
 * Fixtures for the commercial-offer integration specs.
 *
 * Every fixture is UNIQUELY named, and provider-cost rates use a per-call vendor. The integration
 * suite runs in parallel against ONE database and `provider_cost_rates` carries a global unique index
 * over its open-ended rows, so a shared vendor name would make two specs collide — or worse, let one
 * spec's rate quietly change another's margin verdict.
 */

export interface OfferFixtures {
  staff(): Promise<StaffActor>;
  book(mode: "token" | "subscription"): Promise<string>;
  offer(author: StaffActor): Promise<CommercialOfferDto>;
  account(): Promise<string>;
  costRate(ratio: { numerator: bigint; denominator: bigint }): Promise<string>;
  cleanup(): Promise<void>;
}

/**
 * The full text of a refused statement, cause chain included. Drizzle wraps a postgres.js error as
 * "Failed query: …" and hangs the real message — a trigger's RAISE, say — off `cause`, so asserting on
 * the top-level message alone would pass for ANY failure and prove nothing about which guard fired.
 */
export async function rejectionText(
  promise: PromiseLike<unknown>,
): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join(" | ");
  }
  throw new Error("Expected the statement to be refused, but it succeeded.");
}

/** The roadmap's indivisible example: 200 segments for GHS 3.00, which no unit price can express. */
export function versionRequest(
  eligibility: Partial<CreateCommercialOfferVersionRequest["eligibility"]> = {},
): CreateCommercialOfferVersionRequest {
  return {
    currency: "GHS",
    paid_units: "200",
    bonus_units: "0",
    total_price_minor: "300",
    minimum_pack_count: 1,
    maximum_pack_count: 10,
    eligibility: {
      destination_countries: [],
      traffic_classes: [],
      provider_vendors: [],
      service_classes: [],
      ...eligibility,
    },
    effective_from: new Date().toISOString(),
    effective_to: null,
  };
}

export function makeOfferFixtures(db: ProvisioningDb): OfferFixtures {
  const staffIds: string[] = [];
  const bookIds: string[] = [];
  const offerIds: string[] = [];
  const accountIds: string[] = [];
  const rateIds: string[] = [];
  const offers = new CommercialOffersService(
    db,
    new AuditService(db),
    new CommercialOfferMarginService(db),
  );

  return {
    async staff() {
      const email = `offers-${randomUUID()}@fabric.dev`;
      const [row] = await db.db
        .insert(staffUsers)
        .values({ email, role: "admin", status: "active" })
        .returning({ id: staffUsers.id });
      if (!row) throw new Error("staff fixture insert returned no row");
      staffIds.push(row.id);
      return { email, staffId: row.id };
    },

    async book(mode) {
      const [row] = await db.db
        .insert(priceBooks)
        .values({ name: `Offers ${mode} ${randomUUID()}`, mode })
        .returning({ id: priceBooks.id });
      if (!row) throw new Error("price book fixture insert returned no row");
      bookIds.push(row.id);
      return row.id;
    },

    async offer(author) {
      const priceBookId = await this.book("token");
      const created = await offers.createOffer(
        {
          price_book_id: priceBookId,
          code: `starter-${randomUUID().slice(0, 8)}`,
          name: "Starter SMS",
          description: "200 segments",
          channel_code: "sms",
          unit_code: "segment",
        },
        author,
      );
      offerIds.push(created.id);
      return created;
    },

    async account() {
      const id = randomUUID();
      await db.db
        .insert(accounts)
        .values({ id: id as TenantId, name: "Offer test", slug: `off-${id}` });
      accountIds.push(id);
      return id;
    },

    async costRate({ numerator, denominator }) {
      const providerVendor = `fixture-${randomUUID().slice(0, 8)}`;
      const [row] = await db.db
        .insert(providerCostRates)
        .values({
          providerVendor,
          channel: "sms",
          destinationCountry: "GH",
          trafficClass: "transactional",
          currency: "GHS",
          unitBasis: "segment",
          numeratorMinor: numerator as MinorUnits,
          denominator,
          sourceReference: `fixture:${providerVendor}`,
        })
        .returning({ id: providerCostRates.id });
      if (!row) throw new Error("cost rate fixture insert returned no row");
      rateIds.push(row.id);
      return providerVendor;
    },

    async cleanup() {
      if (accountIds.length > 0) {
        await db.db
          .delete(offerCatalogAssignments)
          .where(
            inArray(offerCatalogAssignments.tenantId, accountIds as TenantId[]),
          );
        await db.db
          .delete(accounts)
          .where(inArray(accounts.id, accountIds as TenantId[]));
      }
      if (offerIds.length > 0) {
        await db.db
          .delete(pricingOfferVersions)
          .where(inArray(pricingOfferVersions.offerId, offerIds));
        await db.db
          .delete(pricingOffers)
          .where(inArray(pricingOffers.id, offerIds));
      }
      if (rateIds.length > 0) {
        await db.db
          .delete(providerCostRates)
          .where(inArray(providerCostRates.id, rateIds));
      }
      for (const id of bookIds) {
        await db.db.delete(priceBooks).where(eq(priceBooks.id, id));
      }
      // Staff rows are deleted LAST: `created_by` / `approved_by` are ON DELETE RESTRICT, so the
      // versions above must be gone first.
      if (staffIds.length > 0) {
        await db.db.delete(staffUsers).where(inArray(staffUsers.id, staffIds));
      }
    },
  };
}
