import type { AssignOfferCatalogRequest } from "@app/contracts";
import {
  accounts,
  offerCatalogAssignments,
  type ProvisioningDb,
  type TenantId,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { notFound } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import {
  assertStaffExists,
  assertTokenCatalog,
} from "./commercial-offer-writes.js";
import type { StaffActor } from "./commercial-offers.service.js";

/**
 * Which prepaid catalog a workspace buys from (COM-011, ADR-0012 §8).
 *
 * Separate from `CommercialOffersService` because it answers a different question: that one authors
 * what may be sold, this one decides who may see it. It is also the only write in the domain keyed by
 * TENANT rather than by offer.
 */
@Injectable()
export class OfferCatalogService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Point a workspace at a negotiated catalog, or clear it back to the default. Affects FUTURE
   * purchases only — a purchase snapshots the offer version it bought, so history cannot move.
   *
   * An absent row IS the default, so clearing deletes rather than writing a null: two representations
   * of "no negotiated catalog" would eventually disagree.
   */
  async assign(
    tenantId: string,
    request: AssignOfferCatalogRequest,
    actor: StaffActor,
  ): Promise<{ ok: true }> {
    await assertStaffExists(this.provisioning.db, actor.staffId);
    // Confirm the workspace exists BEFORE either branch. Clearing is a DELETE, which happily affects
    // zero rows for a nonexistent tenant — reporting `ok` and writing an audit entry for work that
    // never happened is the kind of fabricated success this codebase treats as a defect.
    const [account] = await this.provisioning.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, tenantId as TenantId))
      .limit(1);
    if (!account) {
      throw notFound("account_not_found", "Unknown workspace.");
    }
    if (request.offer_catalog_id === null) {
      await this.provisioning.db
        .delete(offerCatalogAssignments)
        .where(eq(offerCatalogAssignments.tenantId, tenantId as TenantId));
    } else {
      await assertTokenCatalog(this.provisioning.db, request.offer_catalog_id);
      await this.provisioning.db
        .insert(offerCatalogAssignments)
        .values({
          tenantId: tenantId as TenantId,
          priceBookId: request.offer_catalog_id,
          assignedBy: actor.staffId,
          reason: request.reason,
        })
        // One catalog per workspace: re-assigning REPLACES, and the primary key makes a duplicate
        // unrepresentable rather than merely unlikely.
        .onConflictDoUpdate({
          target: offerCatalogAssignments.tenantId,
          set: {
            priceBookId: request.offer_catalog_id,
            assignedBy: actor.staffId,
            reason: request.reason,
            updatedAt: new Date(),
          },
        });
    }
    await this.audit.record({
      actorStaffId: actor.staffId,
      actorEmail: actor.email,
      action: "commercial_offer.assign_catalog",
      targetType: "account",
      targetId: tenantId,
      summary: request.offer_catalog_id
        ? `Workspace assigned prepaid catalog ${request.offer_catalog_id}`
        : "Workspace prepaid catalog cleared (→ default)",
      reason: request.reason || null,
      metadata: { offer_catalog_id: request.offer_catalog_id },
    });
    return { ok: true };
  }
}
