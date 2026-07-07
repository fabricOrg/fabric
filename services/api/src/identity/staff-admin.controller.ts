import {
  inviteStaffRequestSchema,
  updateStaffRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest, notFound } from "../http/api-error.js";
import { BffTokenGuard } from "./bff-token.guard.js";
import { StaffService } from "./staff.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Staff management for the admin-console BFF (list + allowlist). BffToken-guarded; the admin-console
 * enforces that the caller is a staff ADMIN (staff:write) before hitting the invite path. Distinct
 * from StaffIdentityController (session resolution) — this is the control plane over staff_users.
 */
@Controller("internal/admin/staff")
@UseGuards(BffTokenGuard)
export class StaffAdminController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Get()
  async list() {
    return this.staff.list();
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
    return this.staff.invite(parsed.data);
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    if (!UUID.test(id)) {
      throw invalidRequest("invalid_staff_id", "Invalid staff id.");
    }
    const parsed = updateStaffRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_staff_update",
        "Provide a role or status to update.",
      );
    }
    const updated = await this.staff.update(id, parsed.data);
    if (!updated) {
      throw notFound("staff_not_found", "That staff member no longer exists.");
    }
    return updated;
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    if (!UUID.test(id)) {
      throw invalidRequest("invalid_staff_id", "Invalid staff id.");
    }
    const removed = await this.staff.remove(id);
    if (!removed) {
      throw notFound("staff_not_found", "That staff member no longer exists.");
    }
    return { ok: true };
  }
}
