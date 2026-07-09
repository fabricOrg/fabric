import {
  inviteMemberRequestSchema,
  updateMemberRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { pageOpts } from "../http/pagination.js";
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
  async list(
    @Param("tenantId") tenantId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    if (!UUID.test(tenantId)) {
      throw invalidRequest("invalid_tenant_id", "Invalid tenant id.");
    }
    return this.members.list(tenantId, pageOpts(limit, cursor));
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

  @Patch(":tenantId/members/:userId")
  async updateRole(
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    if (!UUID.test(tenantId) || !UUID.test(userId)) {
      throw invalidRequest("invalid_id", "Invalid tenant or member id.");
    }
    const parsed = updateMemberRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest("invalid_role", "Provide a valid role.");
    }
    return this.members.updateRole(tenantId, userId, parsed.data);
  }

  @Delete(":tenantId/members/:userId")
  @HttpCode(204)
  async remove(
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
  ) {
    if (!UUID.test(tenantId) || !UUID.test(userId)) {
      throw invalidRequest("invalid_id", "Invalid tenant or member id.");
    }
    await this.members.remove(tenantId, userId);
  }
}
