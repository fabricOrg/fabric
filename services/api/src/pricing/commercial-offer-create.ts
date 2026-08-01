import type {
  CommercialOfferDto,
  CreateCommercialOfferRequest,
  CreateCommercialPackageRequest,
  CreateCommercialPackageResponse,
} from "@app/contracts";
import { type ProvisioningDb, pricingOffers } from "@app/db";
import type { AuditService } from "../audit/audit.service.js";
import { invalidRequest } from "../http/api-error.js";
import { toVersionDto } from "./commercial-offer-mapping.js";
import { readChannel } from "./commercial-offer-reads.js";
import {
  assertStaffExists,
  assertTokenCatalog,
  insertVersion,
  readStaffEmailMap,
  toOfferRowDto,
} from "./commercial-offer-writes.js";
import type { StaffActor } from "./commercial-offers.service.js";

type Db = ProvisioningDb["db"];

export async function assertRegisteredOfferItems(
  db: Db,
  request: Pick<CreateCommercialPackageRequest["version"], "items">,
  pathPrefix = "items",
): Promise<void> {
  for (const [index, item] of request.items.entries()) {
    if (!(await readChannel(db, item.channel_code, item.unit_code))) {
      throw invalidRequest(
        "commercial_channel_not_registered",
        `${item.channel_code}/${item.unit_code} is not a registered channel and unit pair.`,
        `${pathPrefix}.${index}.channel_code`,
      );
    }
  }
}

export async function createOfferIdentity(
  db: Db,
  audit: AuditService,
  request: CreateCommercialOfferRequest,
  actor: StaffActor,
): Promise<CommercialOfferDto> {
  await assertStaffExists(db, actor.staffId);
  await assertTokenCatalog(db, request.price_book_id);
  const [created] = await db
    .insert(pricingOffers)
    .values({
      priceBookId: request.price_book_id,
      code: request.code,
      name: request.name,
      description: request.description,
    })
    .onConflictDoNothing({
      target: [pricingOffers.priceBookId, pricingOffers.code],
    })
    .returning();
  if (!created) throwCodeTaken("code");
  await audit.record({
    actorStaffId: actor.staffId,
    actorEmail: actor.email,
    action: "commercial_offer.create",
    targetType: "pricing_offer",
    targetId: created.id,
    summary: `Package "${created.name}" created`,
    metadata: { code: created.code, price_book_id: created.priceBookId },
  });
  return toOfferRowDto(created);
}

export async function createPackageWithDraft(
  db: Db,
  audit: AuditService,
  request: CreateCommercialPackageRequest,
  actor: StaffActor,
): Promise<CreateCommercialPackageResponse> {
  await assertStaffExists(db, actor.staffId);
  await assertTokenCatalog(db, request.offer.price_book_id);
  await assertRegisteredOfferItems(db, request.version, "version.items");
  const created = await db.transaction(async (tx) => {
    const [offer] = await tx
      .insert(pricingOffers)
      .values({
        priceBookId: request.offer.price_book_id,
        code: request.offer.code,
        name: request.offer.name,
        description: request.offer.description,
      })
      .onConflictDoNothing({
        target: [pricingOffers.priceBookId, pricingOffers.code],
      })
      .returning();
    if (!offer) return null;
    const inserted = await insertVersion(
      tx,
      offer.id,
      1,
      request.version,
      actor.staffId,
    );
    return { offer, ...inserted };
  });
  if (!created) throwCodeTaken("offer.code");
  await audit.record({
    actorStaffId: actor.staffId,
    actorEmail: actor.email,
    action: "commercial_package.create",
    targetType: "pricing_offer",
    targetId: created.offer.id,
    summary: `Package "${created.offer.name}" and draft v1 created`,
    metadata: {
      code: created.offer.code,
      price_book_id: created.offer.priceBookId,
      item_count: created.items.length,
    },
  });
  return {
    offer: toOfferRowDto(created.offer),
    version: toVersionDto(
      created.version,
      await readStaffEmailMap(db),
      created.items,
    ),
  };
}

function throwCodeTaken(param: string): never {
  throw invalidRequest(
    "offer_code_taken",
    "A package with this code already exists in the catalog.",
    param,
  );
}
