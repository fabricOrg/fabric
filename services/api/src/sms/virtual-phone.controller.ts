import { deliveryMode, virtualPhoneReply } from "@app/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
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
  inbox(
    @Param("tenantId") tenantId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") rawLimit?: string,
    @Query("recipient") recipient?: string,
  ) {
    assertUuid(tenantId);
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw invalidRequest(
        "invalid_limit",
        "Limit must be a positive integer.",
      );
    }
    if (recipient && !/^\+[1-9]\d{7,14}$/.test(recipient)) {
      throw invalidRequest(
        "invalid_recipient",
        "Recipient search must be an E.164 phone number.",
      );
    }
    return this.virtualPhone.list(tenantId, {
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit } : {}),
      ...(recipient ? { recipient } : {}),
    });
  }

  @Post(":tenantId/virtual-phone/inbound")
  reply(@Param("tenantId") tenantId: string, @Body() body: unknown) {
    assertUuid(tenantId);
    const parsed = virtualPhoneReply.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_virtual_reply",
        parsed.error.issues[0]?.message ?? "The reply is invalid.",
      );
    }
    return this.virtualPhone.reply(tenantId, parsed.data);
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

  @Delete(":tenantId/virtual-phone/messages")
  async clear(
    @Param("tenantId") tenantId: string,
    @Headers("x-actor-email") actorEmail?: string,
  ) {
    assertUuid(tenantId);
    return { cleared: await this.virtualPhone.clear(tenantId, actorEmail) };
  }
}

function assertUuid(value: string): void {
  if (!UUID.test(value))
    throw invalidRequest("invalid_id", "Invalid identifier.");
}
