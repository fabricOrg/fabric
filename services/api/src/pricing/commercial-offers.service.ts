import type {
  CommercialOfferDto,
  CommercialOfferMarginPreview,
  CommercialOfferVersionDto,
  CreateCommercialOfferRequest,
  CreateCommercialOfferVersionRequest,
  CreateCommercialPackageRequest,
  CreateCommercialPackageResponse,
  ListCommercialOffersResponse,
  PreviewCommercialOfferMarginRequest,
} from "@app/contracts";
import {
  type MinorUnits,
  type ProvisioningDb,
  pricingOffers,
  pricingOfferVersionItems,
  pricingOfferVersions,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq, max } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { cloneVersionRequest } from "./commercial-offer-clone.js";
import {
  assertRegisteredOfferItems,
  createOfferIdentity,
  createPackageWithDraft,
} from "./commercial-offer-create.js";
import {
  toStoredEligibility,
  toVersionDto,
} from "./commercial-offer-mapping.js";
import { CommercialOfferMarginService } from "./commercial-offer-margin.service.js";
import { listOffersWithVersions } from "./commercial-offer-reads.js";
import {
  listChannelRegistry,
  listRouteVocabulary,
} from "./commercial-offer-registry.js";
import {
  assertStaffExists,
  insertVersion,
  loadOfferForWrite,
  readStaffEmailMap,
  requireVersionContext,
} from "./commercial-offer-writes.js";

export interface StaffActor {
  readonly email: string;
  readonly staffId: string;
}

/**
 * Commercial offer authoring (COM-003/COM-011/COM-013, ADR-0012). Staff-only control plane,
 * deliberately separate from pay-as-you-go price books: a rate plan prices a unit, an offer is a
 * PRODUCT with an immutable promise attached. Publication — the price-affecting act — lives in
 * `CommercialOfferPublishService` with its gates.
 */
@Injectable()
export class CommercialOffersService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CommercialOfferMarginService)
    private readonly margin: CommercialOfferMarginService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async list(): Promise<ListCommercialOffersResponse> {
    const [offers, channels, routeVocabulary] = await Promise.all([
      listOffersWithVersions(this.provisioning.db),
      listChannelRegistry(this.provisioning.db),
      listRouteVocabulary(this.provisioning.db),
    ]);
    return {
      offers,
      channels,
      route_vocabulary: routeVocabulary,
      self_approval_allowed:
        this.config.get<string>("PRICING_SELF_APPROVAL_ENABLED") === "true",
    };
  }

  /** A staff actor is REQUIRED here: `created_by` / `approved_by` ARE the approval record. */
  async createOffer(
    request: CreateCommercialOfferRequest,
    actor: StaffActor,
  ): Promise<CommercialOfferDto> {
    return createOfferIdentity(
      this.provisioning.db,
      this.audit,
      request,
      actor,
    );
  }

  async createPackage(
    request: CreateCommercialPackageRequest,
    actor: StaffActor,
  ): Promise<CreateCommercialPackageResponse> {
    return createPackageWithDraft(
      this.provisioning.db,
      this.audit,
      request,
      actor,
    );
  }

  /** Draft-only. A published version is financial evidence: it is cloned, never edited. */
  async createVersion(
    offerId: string,
    request: CreateCommercialOfferVersionRequest,
    actor: StaffActor,
  ): Promise<CommercialOfferVersionDto> {
    await assertStaffExists(this.provisioning.db, actor.staffId);
    await assertRegisteredOfferItems(this.provisioning.db, request);
    const offer = await loadOfferForWrite(this.provisioning.db, offerId);
    const inserted = await this.provisioning.db.transaction(async (tx) => {
      await tx
        .select({ id: pricingOffers.id })
        .from(pricingOffers)
        .where(eq(pricingOffers.id, offerId))
        .for("update");
      const [current] = await tx
        .select({ highest: max(pricingOfferVersions.version) })
        .from(pricingOfferVersions)
        .where(eq(pricingOfferVersions.offerId, offerId));
      return insertVersion(
        tx,
        offer.id,
        (current?.highest ?? 0) + 1,
        request,
        actor.staffId,
      );
    });
    await this.audit.record({
      actorStaffId: actor.staffId,
      actorEmail: actor.email,
      action: "commercial_offer.draft_version",
      targetType: "pricing_offer_version",
      targetId: inserted.version.id,
      summary: `Draft v${inserted.version.version} authored for package "${offer.name}"`,
      metadata: {
        offer_id: offer.id,
        version: inserted.version.version,
        currency: request.currency,
        item_count: inserted.items.length,
        total_price_minor: inserted.version.totalPriceMinor.toString(),
      },
    });
    return toVersionDto(
      inserted.version,
      await readStaffEmailMap(this.provisioning.db),
      inserted.items,
    );
  }

  async updateVersion(
    versionId: string,
    request: CreateCommercialOfferVersionRequest,
    actor: StaffActor,
  ): Promise<CommercialOfferVersionDto> {
    await assertStaffExists(this.provisioning.db, actor.staffId);
    await assertRegisteredOfferItems(this.provisioning.db, request);
    const context = await requireVersionContext(
      this.provisioning.db,
      versionId,
    );
    if (context.version.status !== "draft") {
      throw invalidRequest(
        "offer_version_not_draft",
        "Only a draft package version can be edited. Clone it to change published terms.",
      );
    }
    const paidUnits = sum(request.items.map((item) => item.paid_units));
    const bonusUnits = sum(request.items.map((item) => item.bonus_units));
    const result = await this.provisioning.db.transaction(async (tx) => {
      const [version] = await tx
        .update(pricingOfferVersions)
        .set({
          currency: request.currency,
          paidUnits,
          bonusUnits,
          totalUnits: paidUnits + bonusUnits,
          totalPriceMinor: BigInt(request.total_price_minor) as MinorUnits,
          creditValidityDays: request.credit_validity_days,
          minimumPackCount: request.minimum_pack_count,
          maximumPackCount: request.maximum_pack_count,
          eligibility: {},
          effectiveFrom: new Date(request.effective_from),
          effectiveTo: request.effective_to
            ? new Date(request.effective_to)
            : null,
          costSnapshot: null,
          updatedAt: new Date(),
        })
        .where(eq(pricingOfferVersions.id, versionId))
        .returning();
      if (!version) return null;
      await tx
        .delete(pricingOfferVersionItems)
        .where(eq(pricingOfferVersionItems.offerVersionId, versionId));
      const items = await tx
        .insert(pricingOfferVersionItems)
        .values(
          request.items.map((item, position) => ({
            offerVersionId: versionId,
            position,
            channelCode: item.channel_code,
            unitCode: item.unit_code,
            paidUnits: BigInt(item.paid_units),
            bonusUnits: BigInt(item.bonus_units),
            totalUnits: BigInt(item.paid_units) + BigInt(item.bonus_units),
            eligibility: toStoredEligibility(item.eligibility),
          })),
        )
        .returning();
      return { version, items };
    });
    if (!result) throw notFound("offer_version_not_found", "Unknown version.");
    await this.audit.record({
      actorStaffId: actor.staffId,
      actorEmail: actor.email,
      action: "commercial_offer.edit_draft",
      targetType: "pricing_offer_version",
      targetId: versionId,
      summary: `Draft v${result.version.version} edited for package "${context.offer.name}"`,
      metadata: {
        offer_id: context.offer.id,
        item_count: result.items.length,
        total_price_minor: result.version.totalPriceMinor.toString(),
      },
    });
    return toVersionDto(
      result.version,
      await readStaffEmailMap(this.provisioning.db),
      result.items,
    );
  }

  /** Clone any version's terms into a fresh draft — the sanctioned way to change a published price. */
  async cloneVersion(
    versionId: string,
    actor: StaffActor,
  ): Promise<CommercialOfferVersionDto> {
    const { version, items } = await requireVersionContext(
      this.provisioning.db,
      versionId,
    );
    return this.createVersion(
      version.offerId,
      cloneVersionRequest(version, items),
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
    await assertRegisteredOfferItems(this.provisioning.db, request);
    return this.margin.evaluate({
      priceBookId: offer.priceBookId,
      currency: request.currency,
      totalPriceMinor: BigInt(request.total_price_minor),
      items: request.items.map((item) => ({
        channelCode: item.channel_code,
        unitCode: item.unit_code,
        totalUnits: BigInt(item.paid_units) + BigInt(item.bonus_units),
        eligibility: item.eligibility,
      })),
    });
  }
}

function sum(values: readonly string[]): bigint {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}
