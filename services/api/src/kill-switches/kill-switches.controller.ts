import { toggleKillSwitchRequestSchema } from "@app/contracts";
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
import { invalidRequest, notFound } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { KillSwitchService } from "./kill-switches.service.js";

/**
 * Kill-switch control plane for the admin-console BFF. BffToken-guarded. The acting staff identity
 * is attested by the BFF via x-actor-* headers (it gates on the staff session first) and recorded to
 * the audit log — the body carries only the action.
 */
@Controller("internal/admin/kill-switches")
@UseGuards(BffTokenGuard)
export class KillSwitchController {
  constructor(
    @Inject(KillSwitchService) private readonly killSwitches: KillSwitchService,
  ) {}

  @Get()
  async list() {
    return this.killSwitches.list();
  }

  @Post(":key")
  async toggle(
    @Param("key") key: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const parsed = toggleKillSwitchRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_toggle",
        "Provide `enabled` and a reason (min 8 chars).",
      );
    }
    const updated = await this.killSwitches.toggle(key, parsed.data, {
      email: actorEmail ?? null,
      staffId: actorStaffId ?? null,
    });
    if (!updated) {
      throw notFound("switch_not_found", "Unknown kill switch.");
    }
    return updated;
  }
}
