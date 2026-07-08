import {
  startImpersonationRequestSchema,
  stopImpersonationRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest, unauthorized } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";

/**
 * Records the audit trail for staff impersonation. The sealed claim cookie itself is managed by the
 * admin-console BFF; this endpoint exists so START and STOP are always written to the audit log.
 * BffToken-guarded; actor attested via x-actor-* headers.
 */
@Controller("internal/admin/impersonation")
@UseGuards(BffTokenGuard)
export class ImpersonationController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Post("start")
  async start(
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    if (!actorEmail) {
      throw unauthorized("missing_actor", "Actor identity is required.");
    }
    const parsed = startImpersonationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_impersonation",
        "Invalid impersonation request.",
      );
    }
    await this.audit.record({
      actorStaffId: actorStaffId ?? null,
      actorEmail,
      action: "impersonation.start",
      targetType: "tenant",
      targetId: parsed.data.tenant_id,
      summary: `Started impersonating ${parsed.data.tenant_label}`,
      reason: parsed.data.reason,
    });
    return { ok: true };
  }

  @Post("stop")
  async stop(
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    if (!actorEmail) {
      throw unauthorized("missing_actor", "Actor identity is required.");
    }
    const parsed = stopImpersonationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_impersonation",
        "Invalid impersonation request.",
      );
    }
    await this.audit.record({
      actorStaffId: actorStaffId ?? null,
      actorEmail,
      action: "impersonation.stop",
      targetType: "tenant",
      targetId: parsed.data.tenant_id,
      summary: `Stopped impersonating ${parsed.data.tenant_label}`,
    });
    return { ok: true };
  }
}
