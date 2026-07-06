import { inviteStaffRequestSchema } from "@app/contracts";
import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "./bff-token.guard.js";
import { IdentityService } from "./identity.service.js";

/**
 * Staff management for the admin-console BFF (list + allowlist). BffToken-guarded; the admin-console
 * enforces that the caller is a staff ADMIN (staff:write) before hitting the invite path. Distinct
 * from StaffIdentityController (session resolution) — this is the control plane over staff_users.
 */
@Controller("internal/admin/staff")
@UseGuards(BffTokenGuard)
export class StaffAdminController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  @Get()
  async list() {
    return this.identity.listStaff();
  }

  @Post()
  async invite(@Body() body: unknown) {
    const parsed = inviteStaffRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_staff_invite",
        "The staff invite request is invalid.",
      );
    }
    return this.identity.inviteStaff(parsed.data);
  }
}
