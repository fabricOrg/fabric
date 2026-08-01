import {
  assignOfferCatalogRequestSchema,
  createCommercialOfferRequestSchema,
  createCommercialOfferVersionRequestSchema,
  createCommercialPackageRequestSchema,
  previewCommercialOfferMarginRequestSchema,
  publishCommercialOfferVersionRequestSchema,
  retireCommercialOfferVersionRequestSchema,
  updateCommercialOfferVersionRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { CommercialOfferPublishService } from "./commercial-offer-publish.service.js";
import {
  CommercialOffersService,
  type StaffActor,
} from "./commercial-offers.service.js";
import { OfferCatalogService } from "./offer-catalog.service.js";

/**
 * Commercial offer control plane for the admin-console BFF (ADR-0012). BffToken-guarded; the acting
 * staff identity is attested by the BFF via `x-actor-*` after it has checked the staff session and
 * role. Unlike price books, that identity is MANDATORY here — `created_by` and `approved_by` are the
 * approval record, and an anonymous publish would defeat separation of duties.
 */
@Controller("internal/admin/commercial-offers")
@UseGuards(BffTokenGuard)
export class CommercialOffersController {
  constructor(
    @Inject(CommercialOffersService)
    private readonly offers: CommercialOffersService,
    @Inject(CommercialOfferPublishService)
    private readonly publishing: CommercialOfferPublishService,
    @Inject(OfferCatalogService)
    private readonly catalogs: OfferCatalogService,
  ) {}

  @Get()
  async list() {
    return this.offers.list();
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const request = parse(createCommercialOfferRequestSchema, body, "offer");
    return this.offers.createOffer(request, actor(actorEmail, actorStaffId));
  }

  @Post("packages")
  async createPackage(
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const request = parse(
      createCommercialPackageRequestSchema,
      body,
      "commercial package",
    );
    return this.offers.createPackage(request, actor(actorEmail, actorStaffId));
  }

  @Post(":offerId/versions")
  async createVersion(
    @Param("offerId") offerId: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const request = parse(
      createCommercialOfferVersionRequestSchema,
      body,
      "offer version",
    );
    return this.offers.createVersion(
      uuidParam(offerId, "offerId"),
      request,
      actor(actorEmail, actorStaffId),
    );
  }

  @Put("versions/:versionId")
  async updateVersion(
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const request = parse(
      updateCommercialOfferVersionRequestSchema,
      body,
      "offer version",
    );
    return this.offers.updateVersion(
      uuidParam(versionId, "versionId"),
      request,
      actor(actorEmail, actorStaffId),
    );
  }

  @Post("versions/:versionId/clone")
  async cloneVersion(
    @Param("versionId") versionId: string,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    return this.offers.cloneVersion(
      uuidParam(versionId, "versionId"),
      actor(actorEmail, actorStaffId),
    );
  }

  /** Read-only verdict for unsaved terms. No actor needed: it changes nothing. */
  @Post("margin-preview")
  async preview(@Body() body: unknown) {
    const request = parse(
      previewCommercialOfferMarginRequestSchema,
      body,
      "margin preview",
    );
    return this.offers.preview(request);
  }

  @Post("versions/:versionId/publish")
  async publish(
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const request = parse(
      publishCommercialOfferVersionRequestSchema,
      body,
      "publish request",
    );
    return this.publishing.publish(
      uuidParam(versionId, "versionId"),
      request,
      actor(actorEmail, actorStaffId),
    );
  }

  @Post("versions/:versionId/retire")
  async retire(
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const request = parse(
      retireCommercialOfferVersionRequestSchema,
      body,
      "retire request",
    );
    return this.publishing.retire(
      uuidParam(versionId, "versionId"),
      request,
      actor(actorEmail, actorStaffId),
    );
  }

  @Post("catalog-assignments/:tenantId")
  async assignCatalog(
    @Param("tenantId") tenantId: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const request = parse(
      assignOfferCatalogRequestSchema,
      body,
      "catalog assignment",
    );
    return this.catalogs.assign(
      uuidParam(tenantId, "tenantId"),
      request,
      actor(actorEmail, actorStaffId),
    );
  }
}

/**
 * Path ids are validated like every other input. Without this a non-uuid reaches Postgres and raises
 * `22P02 invalid input syntax for type uuid`, which surfaces as an opaque 500 — the one shape of error
 * this domain's callers cannot branch on.
 */
function uuidParam(value: string, name: string): string {
  if (!z.string().uuid().safeParse(value).success) {
    throw invalidRequest("invalid_id", `${name} must be a UUID.`, name);
  }
  return value;
}

function parse<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  label: string,
): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw invalidRequest(
      "invalid_commercial_offer",
      parsed.error.issues[0]?.message ?? `Invalid ${label}.`,
      parsed.error.issues[0]?.path.join(".") || undefined,
    );
  }
  return parsed.data;
}

/**
 * A staff id is not optional on these routes. Missing it means the BFF is misconfigured rather than
 * the request being wrong, but it must still fail — attributing a price change to nobody is worse
 * than refusing it.
 */
function actor(
  email: string | undefined,
  staffId: string | undefined,
): StaffActor {
  if (!email || !staffId) {
    throw invalidRequest(
      "staff_actor_required",
      "A staff actor is required to author or approve commercial pricing.",
    );
  }
  return { email, staffId };
}
