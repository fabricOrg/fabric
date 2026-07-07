import { resolveStaffSessionRequestSchema } from "@app/contracts";
import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { forbidden, invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "./bff-token.guard.js";
import { StaffService } from "./staff.service.js";

/**
 * Staff session resolution for the admin-console BFF. BffTokenGuard ONLY — staff are platform
 * operators, not tenant users, so there's no ApiKeyGuard/tenant here (unlike IdentityController).
 */
@Controller("internal/identity")
@UseGuards(BffTokenGuard)
export class StaffIdentityController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Post("staff-session")
  async resolve(@Body() body: unknown) {
    const parsed = resolveStaffSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_staff_claims",
        "The staff session claims are invalid.",
      );
    }
    const resolved = await this.staff.resolveSession(parsed.data);
    if (!resolved) {
      throw forbidden(
        "staff_not_authorized",
        "This identity is not on the staff allowlist.",
      );
    }
    return resolved;
  }
}
