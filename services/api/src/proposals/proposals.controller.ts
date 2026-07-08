import {
  createProposalRequestSchema,
  decideProposalRequestSchema,
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
