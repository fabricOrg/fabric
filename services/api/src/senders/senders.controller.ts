import {
  createSenderRequestSchema,
  decideSenderRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { invalidRequest, unauthorized } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { SendersService } from "./senders.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/** Customer surface: register + list sender ids (dashboard BFF or sk_* key). */
@Controller("v1/senders")
@UseGuards(ApiKeyGuard)
export class SendersController {
  constructor(
    @Inject(SendersService) private readonly senders: SendersService,
  ) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    const tenant = requireScope(req.tenant, "sms:read");
    return { senders: await this.senders.list(tenant.id) };
  }

  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const tenant = requireScope(req.tenant, "sms:send");
    const parsed = createSenderRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_sender_request",
        parsed.error.issues[0]?.message ??
          "The sender registration is invalid.",
        String(parsed.error.issues[0]?.path[0] ?? "sender_id"),
      );
    }
    return this.senders.create(tenant.id, parsed.data);
  }
}

/** Staff surface: review queue + decisions (admin-console BFF, actor attested by headers). */
@Controller("internal/admin/senders")
@UseGuards(BffTokenGuard)
export class SendersAdminController {
  constructor(
    @Inject(SendersService) private readonly senders: SendersService,
  ) {}

  @Get()
  async queue() {
    return { senders: await this.senders.reviewQueue() };
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
    const parsed = decideSenderRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest("invalid_decision", "The decision is invalid.");
    }
    return this.senders.decide(id, parsed.data, {
      email: actorEmail,
      staffId: actorStaffId ?? null,
    });
  }
}
