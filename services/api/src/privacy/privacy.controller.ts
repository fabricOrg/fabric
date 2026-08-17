import { erasureRequestSchema } from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest, notFound } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { PiiErasureService } from "./pii-erasure.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DSR surface (COMPLIANCE §6). Staff/internal only: guarded by the BFF token and called by the
 * admin-console server, never a browser. The tenant id comes from the path (staff act ACROSS
 * tenants), but every query still runs inside `withTenant` — RLS remains the boundary, and an
 * operator cannot reach a subject in a workspace they did not name.
 */
@Controller("internal/admin/privacy")
@UseGuards(BffTokenGuard)
export class PrivacyController {
  constructor(
    @Inject(PiiErasureService) private readonly erasure: PiiErasureService,
  ) {}

  /** What personal data does this workspace hold on this number? Kinds only — never the values. */
  @Get("tenants/:tenantId/subject")
  async summary(
    @Param("tenantId") tenantId: string,
    @Query("msisdn") msisdn?: string,
  ) {
    assertUuid(tenantId);
    if (!msisdn) {
      throw invalidRequest("msisdn_required", "A phone number is required.");
    }
    const summary = await this.erasure.subjectSummary(tenantId, msisdn);
    if (!summary) {
      // 404, not a 200 carrying `{ found: false }`. Every other missing resource in this API
      // answers notFound (`email_not_found`, `message_not_found`, `tenant_not_found`); this one
      // returning a success envelope with a sentinel made the response TWO shapes, so no single
      // contract could describe it and validation rejected the miss. Breaking, pre-prod, §11.
      throw notFound(
        "subject_not_found",
        "No data subject is held for that number in this workspace.",
      );
    }
    return summary;
  }

  /**
   * Crypto-shred everything this workspace holds on this number. IRREVERSIBLE — the key is
   * destroyed, not the rows, and no backup restores it. The actor comes from the authenticated
   * staff session (the BFF supplies it), never from the request body.
   */
  @Post("tenants/:tenantId/erasures")
  async erase(
    @Param("tenantId") tenantId: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
  ) {
    assertUuid(tenantId);
    const parsed = erasureRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_erasure_request",
        parsed.error.issues[0]?.message ??
          "A valid phone number and legal basis are required.",
      );
    }
    if (!actorEmail) {
      // An unattributable erasure is not an auditable one, and this action must always be attributable.
      throw invalidRequest(
        "actor_required",
        "The acting staff member could not be identified.",
      );
    }
    return this.erasure.eraseByPhone({
      tenantId,
      e164: parsed.data.msisdn,
      requestedBy: actorEmail,
      basis: parsed.data.basis,
    });
  }
}

function assertUuid(value: string): void {
  if (!UUID.test(value)) {
    throw invalidRequest("invalid_id", "Invalid workspace id.");
  }
}
