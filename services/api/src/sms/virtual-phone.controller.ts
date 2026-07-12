import { deliveryMode } from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("internal/tenants")
@UseGuards(BffTokenGuard)
export class VirtualPhoneController {
  constructor(
    @Inject(VirtualPhoneService)
    private readonly virtualPhone: VirtualPhoneService,
  ) {}

  @Get(":tenantId/messaging-settings")
  settings(@Param("tenantId") tenantId: string) {
    assertUuid(tenantId);
    return this.virtualPhone.settings(tenantId);
  }

  @Patch(":tenantId/messaging-settings")
  updateSettings(
    @Param("tenantId") tenantId: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
  ) {
    assertUuid(tenantId);
    const parsed = deliveryMode.safeParse(
      (body as { delivery_mode?: unknown })?.delivery_mode,
    );
    if (!parsed.success)
      throw invalidRequest(
        "invalid_delivery_mode",
        "Delivery mode must be virtual or live.",
      );
    return this.virtualPhone.updateSettings(tenantId, parsed.data, actorEmail);
  }

  @Get(":tenantId/virtual-phone/messages")
  inbox(@Param("tenantId") tenantId: string) {
    assertUuid(tenantId);
    return this.virtualPhone.list(tenantId);
  }

  @Patch(":tenantId/virtual-phone/messages/:messageId/read")
  async markRead(
    @Param("tenantId") tenantId: string,
    @Param("messageId") messageId: string,
  ) {
    assertUuid(tenantId);
    assertUuid(messageId);
    await this.virtualPhone.markRead(tenantId, messageId);
    return { ok: true };
  }
}

function assertUuid(value: string): void {
  if (!UUID.test(value))
    throw invalidRequest("invalid_id", "Invalid identifier.");
}
