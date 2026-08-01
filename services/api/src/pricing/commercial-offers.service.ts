import type {
  CommercialOfferDto,
  CommercialOfferMarginPreview,
  CommercialOfferVersionDto,
  CreateCommercialOfferRequest,
  CreateCommercialOfferVersionRequest,
  Currency,
  ListCommercialOffersResponse,
  PreviewCommercialOfferMarginRequest,
} from "@app/contracts";
import {
  type MinorUnits,
  type ProvisioningDb,
  pricingOffers,
  pricingOfferVersions,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq, max } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import {
  toStoredEligibility,
  toVersionDto,
} from "./commercial-offer-mapping.js";
import { CommercialOfferMarginService } from "./commercial-offer-margin.service.js";
import {
  listChannelRegistry,
  listOffersWithVersions,
  readChannel,
} from "./commercial-offer-reads.js";
import {
  assertStaffExists,
  assertTokenCatalog,
  eligibilityOf,
  insertVersion,
  loadOfferForWrite,
  readStaffEmailMap,
  requireVersionContext,
  toOfferRowDto,
} from "./commercial-offer-writes.js";

/** A staff actor is REQUIRED here: `created_by` / `approved_by` ARE the approval record. */
export interface StaffActor {
  readonly email: string;
  readonly staffId: string;
}

/**
 * Commercial offer authoring (COM-003/COM-011, ADR-0012). Staff-only control plane, deliberately
 * separate from pay-as-you-go price books: a rate plan prices a unit, an offer is a PRODUCT with an
 * immutable promise attached. Publication — the price-affecting act — lives in
 * `CommercialOfferPublishService` with its gates.
 */
@Injectable()
export class CommercialOffersService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CommercialOfferMarginService)
    private readonly margin: CommercialOfferMarginService,
  ) {}

  async list(): Promise<ListCommercialOffersResponse> {
    const [offers, channels] = await Promise.all([
      listOffersWithVersions(this.provisioning.db),
      listChannelRegistry(this.provisioning.db),
    ]);
    return { offers, channels };
  }

  async createOffer(
    request: CreateCommercialOfferRequest,
    actor: StaffActor,
  ): Promise<CommercialOfferDto> {
    await assertStaffExists(this.provisioning.db, actor.staffId);
    await assertTokenCatalog(this.provisioning.db, request.price_book_id);
    // A draft may target a REGISTERED channel that is not yet active (ADR-0012 §2) — deliverability is
    // proven at publish. An unregistered pair has no natural unit at all, so it is refused here.
    const channel = await readChannel(
      this.provisioning.db,
      request.channel_code,
      request.unit_code,
    );
    if (!channel) {
      throw invalidRequest(
        "commercial_channel_not_registered",
        `${request.channel_code}/${request.unit_code} is not a registered channel and unit pair.`,
        "channel_code",
      );
    }

    const [created] = await this.provisioning.db
      .insert(pricingOffers)
      .values({
        priceBookId: request.price_book_id,
        code: request.code,
        name: request.name,
        description: request.description,
        channelCode: request.channel_code,
        unitCode: request.unit_code,
      })
      .onConflictDoNothing({
        target: [pricingOffers.priceBookId, pricingOffers.code],
      })
      .returning();
    if (!created) {
      throw invalidRequest(
        "offer_code_taken",
        "An offer with this code already exists in the catalog.",
        "code",
      );
    }
    await this.audit.record({
      actorStaffId: actor.staffId,
      actorEmail: actor.email,
      action: "commercial_offer.create",
      targetType: "pricing_offer",
      targetId: created.id,
      summary: `Offer "${created.name}" created`,
      metadata: {
        code: created.code,
        channel_code: created.channelCode,
        unit_code: created.unitCode,
        price_book_id: created.priceBookId,
      },
    });
    return toOfferRowDto(created);
  }

  async createVersion(
    offerId: string,
    request: CreateCommercialOfferVersionRequest,
    actor: StaffActor,
  ): Promise<CommercialOfferVersionDto> {
    await assertStaffExists(this.provisioning.db, actor.staffId);
    const offer = await loadOfferForWrite(this.provisioning.db, offerId);
    const [current] = await this.provisioning.db
      .select({ highest: max(pricingOfferVersions.version) })
      .from(pricingOfferVersions)
      .where(eq(pricingOfferVersions.offerId, offerId));
    const version = (current?.highest ?? 0) + 1;
    const row = await insertVersion(
      this.provisioning.db,
      offer.id,
      version,
      request,
      actor.staffId,
    );
    await this.audit.record({
      actorStaffId: actor.staffId,
      actorEmail: actor.email,
      action: "commercial_offer.draft_version",
      targetType: "pricing_offer_version",
      targetId: row.id,
      summary: `Draft v${version} authored for offer "${offer.name}"`,
      metadata: {
        offer_id: offer.id,
        version,
        currency: request.currency,
        total_units: row.totalUnits.toString(),
        total_price_minor: row.totalPriceMinor.toString(),
      },
    });
    return toVersionDto(row, await readStaffEmailMap(this.provisioning.db));
  }

  /** Draft-only. A published version is financial evidence: it is cloned, never edited. */
  async updateVersion(
    versionId: string,
    request: CreateCommercialOfferVersionRequest,
    actor: StaffActor,
  ): Promise<CommercialOfferVersionDto> {
    await assertStaffExists(this.provisioning.db, actor.staffId);
    const context = await requireVersionContext(
      this.provisioning.db,
      versionId,
    );
    if (context.version.status !== "draft") {
      throw invalidRequest(
        "offer_version_not_draft",
        "Only a draft version can be edited. Clone it to change published terms.",
      );
    }
    const [updated] = await this.provisioning.db
      .update(pricingOfferVersions)
      .set({
        currency: request.currency,
        paidUnits: BigInt(request.paid_units),
        bonusUnits: BigInt(request.bonus_units),
        totalUnits: BigInt(request.paid_units) + BigInt(request.bonus_units),
        totalPriceMinor: BigInt(request.total_price_minor) as MinorUnits,
        minimumPackCount: request.minimum_pack_count,
        maximumPackCount: request.maximum_pack_count,
        eligibility: toStoredEligibility(request.eligibility),
        effectiveFrom: new Date(request.effective_from),
        effectiveTo: request.effective_to
          ? new Date(request.effective_to)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(pricingOfferVersions.id, versionId))
      .returning();
    if (!updated) throw notFound("offer_version_not_found", "Unknown version.");
    await this.audit.record({
      actorStaffId: actor.staffId,
      actorEmail: actor.email,
      action: "commercial_offer.edit_draft",
      targetType: "pricing_offer_version",
      targetId: versionId,
      summary: `Draft v${updated.version} edited for offer "${context.offer.name}"`,
      metadata: {
        offer_id: context.offer.id,
        total_units: updated.totalUnits.toString(),
        total_price_minor: updated.totalPriceMinor.toString(),
      },
    });
    return toVersionDto(updated, await readStaffEmailMap(this.provisioning.db));
  }

  /** Clone any version's terms into a fresh draft — the sanctioned way to change a published price. */
  async cloneVersion(
    versionId: string,
    actor: StaffActor,
  ): Promise<CommercialOfferVersionDto> {
    const { version } = await requireVersionContext(
      this.provisioning.db,
      versionId,
    );
    return this.createVersion(
      version.offerId,
      {
        currency: version.currency as Currency,
        paid_units: version.paidUnits.toString(),
        bonus_units: version.bonusUnits.toString(),
        total_price_minor: version.totalPriceMinor.toString(),
        minimum_pack_count: version.minimumPackCount,
        maximum_pack_count: version.maximumPackCount,
        eligibility: eligibilityOf(version),
        effective_from: version.effectiveFrom.toISOString(),
        effective_to: version.effectiveTo?.toISOString() ?? null,
      },
      actor,
    );
  }

  /** The same verdict `publish` enforces, for terms that may not be saved yet. */
  async preview(
    request: PreviewCommercialOfferMarginRequest,
  ): Promise<CommercialOfferMarginPreview> {
    const offer = await loadOfferForWrite(
      this.provisioning.db,
      request.offer_id,
    );
    return this.margin.evaluate({
      channelCode: offer.channelCode,
      priceBookId: offer.priceBookId,
      currency: request.currency,
      totalUnits: BigInt(request.paid_units) + BigInt(request.bonus_units),
      totalPriceMinor: BigInt(request.total_price_minor),
      eligibility: request.eligibility,
    });
  }
}
