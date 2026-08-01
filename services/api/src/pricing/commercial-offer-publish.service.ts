import type {
  CommercialOfferVersionDto,
  Currency,
  PublishCommercialOfferVersionRequest,
  RetireCommercialOfferVersionRequest,
} from "@app/contracts";
import {
  type MinorUnits,
  type ProvisioningDb,
  pricingOffers,
  pricingOfferVersionItems,
  pricingOfferVersions,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { toVersionDto } from "./commercial-offer-mapping.js";
import {
  CommercialOfferMarginService,
  toStoredCostSnapshot,
} from "./commercial-offer-margin.service.js";
import { readChannel } from "./commercial-offer-reads.js";
import {
  assertNoOverlappingPublishedVersion,
  assertStaffExists,
  eligibilityOf,
  offerTermsUnchanged,
  readStaffEmailMap,
  readVersionForUpdate,
  readVersionItemsForUpdate,
  requireVersionContext,
} from "./commercial-offer-writes.js";
import type { StaffActor } from "./commercial-offers.service.js";

/**
 * Publication and retirement — the two lifecycle transitions that carry money consequences.
 *
 * Publishing a version is the moment a price becomes sellable, so it is the only place in this domain
 * with a full gate: a second staff actor, an ACTIVE channel, provider-cost evidence for every
 * permitted route, the catalog's margin floor, and no window already occupied. Each gate fails closed.
 */
@Injectable()
export class CommercialOfferPublishService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CommercialOfferMarginService)
    private readonly margin: CommercialOfferMarginService,
  ) {}

  async publish(
    versionId: string,
    request: PublishCommercialOfferVersionRequest,
    actor: StaffActor,
  ): Promise<CommercialOfferVersionDto> {
    await assertStaffExists(this.provisioning.db, actor.staffId);
    const { version, offer, items } = await requireVersionContext(
      this.provisioning.db,
      versionId,
    );
    if (version.status !== "draft") {
      throw invalidRequest(
        "offer_version_not_draft",
        "Only a draft version can be published.",
      );
    }
    // Separation of duties. Also a database CHECK (0110), so a caller bypassing this service is still
    // refused — this is the readable error, not the only guard.
    if (version.createdBy === actor.staffId) {
      throw invalidRequest(
        "offer_publish_self_approval",
        "You authored this version — another staff admin must publish it.",
      );
    }
    for (const item of items) {
      const channel = await readChannel(
        this.provisioning.db,
        item.channelCode,
        item.unitCode,
      );
      if (!channel?.isActive) {
        throw invalidRequest(
          "commercial_channel_inactive",
          `The ${item.channelCode} channel is not active, so this package cannot be sold yet.`,
        );
      }
    }

    const preview = await this.margin.evaluate({
      priceBookId: offer.priceBookId,
      currency: version.currency as Currency,
      totalPriceMinor: version.totalPriceMinor,
      items: items.map((item) => ({
        channelCode: item.channelCode,
        unitCode: item.unitCode,
        totalUnits: item.totalUnits,
        eligibility: eligibilityOf(item),
      })),
    });
    if (!preview.publishable) {
      throw invalidRequest(
        preview.blocked_reason ?? "offer_not_publishable",
        preview.blocked_detail ??
          "This offer does not satisfy the catalog's margin floor.",
      );
    }

    const approvedAt = new Date();
    const published = await this.provisioning.db.transaction(async (tx) => {
      // Serialize concurrent publishes of the SAME offer. Without the lock, two versions could pass
      // the overlap check independently and both become effective — "the current price" with two
      // answers is exactly what a purchase cannot resolve.
      await tx
        .select({ id: pricingOffers.id })
        .from(pricingOffers)
        .where(eq(pricingOffers.id, offer.id))
        .for("update");
      // Re-read under the lock and confirm the terms are still the ones the gate judged. The margin
      // verdict was computed from the row as READ, and this UPDATE rewrites only lifecycle columns —
      // so a draft edited in the meantime would go live with a snapshot describing different terms.
      const current = await readVersionForUpdate(tx, versionId);
      if (current?.status !== "draft") return "not_draft" as const;
      const currentItems = await readVersionItemsForUpdate(tx, versionId);
      if (!offerTermsUnchanged(version, current, items, currentItems)) {
        return "changed" as const;
      }

      await assertNoOverlappingPublishedVersion(tx, current);
      for (const allocation of preview.items) {
        // item_index is an ORDINAL into the same ordered list the preview was computed from, not a
        // `position` value. Matching it against the column would silently mismatch the moment a
        // position sequence has a gap, and report it as "edited while you were reviewing".
        const item = currentItems[allocation.item_index];
        if (!item) return "changed" as const;
        await tx
          .update(pricingOfferVersionItems)
          .set({
            allocatedPriceMinor: BigInt(
              allocation.allocated_price_minor,
            ) as MinorUnits,
            updatedAt: approvedAt,
          })
          .where(eq(pricingOfferVersionItems.id, item.id));
      }
      const [row] = await tx
        .update(pricingOfferVersions)
        .set({
          status: "published",
          costSnapshot: toStoredCostSnapshot(preview),
          approvedBy: actor.staffId,
          approvedAt,
          updatedAt: approvedAt,
        })
        .where(
          and(
            eq(pricingOfferVersions.id, versionId),
            eq(pricingOfferVersions.status, "draft"),
          ),
        )
        .returning();
      return row ?? null;
    });
    if (published === "changed") {
      throw invalidRequest(
        "offer_version_changed",
        "These terms were edited while you were reviewing them. Re-check the margin, then publish.",
      );
    }
    if (published === "not_draft" || !published) {
      throw invalidRequest(
        "offer_version_not_draft",
        "This version was decided by someone else while you were reviewing it.",
      );
    }
    await this.audit.record({
      actorStaffId: actor.staffId,
      actorEmail: actor.email,
      action: "commercial_offer.publish",
      targetType: "pricing_offer_version",
      targetId: versionId,
      summary: `Published v${published.version} of offer "${offer.name}"`,
      reason: request.reason,
      metadata: {
        offer_id: offer.id,
        author_staff_id: version.createdBy,
        currency: published.currency,
        item_count: items.length,
        total_price_minor: published.totalPriceMinor.toString(),
        worst_case_margin_bps:
          preview.cost_snapshot?.worst_case_margin_bps ?? null,
        minimum_margin_bps: preview.cost_snapshot?.minimum_margin_bps ?? null,
        minimum_margin_source:
          preview.cost_snapshot?.minimum_margin_source ?? null,
        route_count: preview.cost_snapshot?.route_count ?? null,
      },
    });
    const publishedItems = await readVersionItemsForUpdate(
      this.provisioning.db,
      versionId,
    );
    return toVersionDto(
      published,
      await readStaffEmailMap(this.provisioning.db),
      publishedItems,
    );
  }

  /**
   * Retirement changes lifecycle ONLY — every purchased term stays exactly as sold, which is why the
   * update touches `status` alone (0110's trigger rejects anything else on a published row).
   *
   * No second actor is required: the original approver stays on the row, and withdrawing an offer from
   * sale cannot overcharge anyone.
   */
  async retire(
    versionId: string,
    request: RetireCommercialOfferVersionRequest,
    actor: StaffActor,
  ): Promise<CommercialOfferVersionDto> {
    await assertStaffExists(this.provisioning.db, actor.staffId);
    const { version, offer } = await requireVersionContext(
      this.provisioning.db,
      versionId,
    );
    if (version.status !== "published") {
      throw invalidRequest(
        "offer_version_not_published",
        "Only a published version can be retired.",
      );
    }
    const [retired] = await this.provisioning.db
      .update(pricingOfferVersions)
      .set({ status: "retired", updatedAt: new Date() })
      .where(
        and(
          eq(pricingOfferVersions.id, versionId),
          eq(pricingOfferVersions.status, "published"),
        ),
      )
      .returning();
    if (!retired) {
      throw invalidRequest(
        "offer_version_not_published",
        "This version is no longer published.",
      );
    }
    await this.audit.record({
      actorStaffId: actor.staffId,
      actorEmail: actor.email,
      action: "commercial_offer.retire",
      targetType: "pricing_offer_version",
      targetId: versionId,
      summary: `Retired v${retired.version} of offer "${offer.name}"`,
      reason: request.reason,
      metadata: { offer_id: offer.id, version: retired.version },
    });
    const items = await readVersionItemsForUpdate(
      this.provisioning.db,
      versionId,
    );
    return toVersionDto(
      retired,
      await readStaffEmailMap(this.provisioning.db),
      items,
    );
  }
}
