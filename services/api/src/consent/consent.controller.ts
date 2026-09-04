import { createOptOutRequestSchema } from "@app/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { invalidRequest } from "../http/api-error.js";
import { ConsentService } from "./consent.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/** Opt-out management (E10-S5): the customer's consent registry. */
@Controller("v1/opt-outs")
@UseGuards(ApiKeyGuard)
export class ConsentController {
  constructor(
    @Inject(ConsentService) private readonly consent: ConsentService,
  ) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    const tenant = requireScope(req.tenant, "sms:read");
    return { opt_outs: await this.consent.list(tenant.id) };
  }

  @Post()
  async add(@Req() req: AuthedRequest, @Body() body: unknown) {
    const tenant = requireScope(req.tenant, "sms:send");
    const parsed = createOptOutRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_opt_out",
        parsed.error.issues[0]?.message ?? "The opt-out is invalid.",
        String(parsed.error.issues[0]?.path[0] ?? "msisdn"),
      );
    }
    return this.consent.add(tenant.id, parsed.data);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    const tenant = requireScope(req.tenant, "sms:send");
    await this.consent.remove(tenant.id, id);
  }
}
