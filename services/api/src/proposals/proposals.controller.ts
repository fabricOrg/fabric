import {
  createProposalRequestSchema,
  decideProposalRequestSchema,
  goLiveRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest, notFound, unauthorized } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProposalService } from "./proposals.service.js";

/**
 * Maker-checker control plane for the admin-console BFF. BffToken-guarded; the acting staff identity
 * is attested by the BFF via x-actor-* headers (used as maker/checker + audited). The body carries
 * only the proposal/decision data.
 */
@Controller("internal/admin/proposals")
@UseGuards(BffTokenGuard)
export class ProposalController {
  constructor(
    @Inject(ProposalService) private readonly proposals: ProposalService,
  ) {}

  @Get()
  async list() {
    return this.proposals.list();
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    if (!actorEmail) {
      throw unauthorized("missing_actor", "Actor identity is required.");
    }
    const parsed = createProposalRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest("invalid_proposal", "The proposal is invalid.");
    }
    return this.proposals.create(parsed.data, {
      email: actorEmail,
      staffId: actorStaffId ?? null,
    });
  }

  /**
   * ADR-0002 F4 — customer go-live (dashboard BFF). The BFF supplies the tenant id from the
   * authenticated session (x-tenant-id) and the requester email (x-actor-email); the body is
   * only the business info. BffTokenGuard is the service credential, same trust as /session.
   */
  @Post("go-live")
  async requestGoLive(
    @Body() body: unknown,
    @Headers("x-tenant-id") tenantId?: string,
    @Headers("x-actor-email") actorEmail?: string,
  ) {
    if (!tenantId || !actorEmail) {
      throw unauthorized("missing_actor", "Tenant and requester are required.");
    }
    const parsed = goLiveRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_go_live_request",
        parsed.error.issues[0]?.message ?? "The go-live request is invalid.",
      );
    }
    return this.proposals.requestGoLive(tenantId, parsed.data, actorEmail);
  }

  @Get("go-live/status")
  async goLiveStatus(@Headers("x-tenant-id") tenantId?: string) {
    if (!tenantId) {
      throw unauthorized("missing_actor", "Tenant is required.");
    }
    return this.proposals.goLiveStatus(tenantId);
  }

  @Post(":id/decide")
  async decide(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    if (!actorEmail) {
      throw unauthorized("missing_actor", "Actor identity is required.");
    }
    const parsed = decideProposalRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest("invalid_decision", "The decision is invalid.");
    }
    const updated = await this.proposals.decide(id, parsed.data, {
      email: actorEmail,
      staffId: actorStaffId ?? null,
    });
    if (!updated) throw notFound("proposal_not_found", "Unknown proposal.");
    return updated;
  }
}
