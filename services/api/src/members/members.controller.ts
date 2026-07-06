import { inviteMemberRequestSchema } from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { MembersService } from "./members.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant team-member endpoints. Guarded by the BFF token — called by the dashboard server (never a
 * browser), which supplies the tenant id from the authenticated session and enforces owner/admin.
 */
@Controller("internal/tenants")
@UseGuards(BffTokenGuard)
export class MembersController {
  constructor(
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  @Get(":tenantId/members")
  async list(@Param("tenantId") tenantId: string) {
    if (!UUID.test(tenantId)) {
      throw invalidRequest("invalid_tenant_id", "Invalid tenant id.");
    }
    return this.members.list(tenantId);
  }

  @Post(":tenantId/members")
  async invite(@Param("tenantId") tenantId: string, @Body() body: unknown) {
    if (!UUID.test(tenantId)) {
      throw invalidRequest("invalid_tenant_id", "Invalid tenant id.");
    }
    const parsed = inviteMemberRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_invite_request",
        "The member invite request is invalid.",
      );
    }
    return this.members.invite(tenantId, parsed.data);
  }
}
