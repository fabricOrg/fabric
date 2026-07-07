import {
  initiateTopUpRequestSchema,
  updateAutoTopupRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { invalidRequest } from "../http/api-error.js";
import { AutoTopupService } from "./auto-topup.service.js";
import { PaymentsService } from "./payments.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/** Tenant-facing top-up initiation (dashboard BFF → api key). Returns the hosted-checkout URL. */
@Controller("v1/wallet")
@UseGuards(ApiKeyGuard)
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(AutoTopupService) private readonly autoTopup: AutoTopupService,
  ) {}

  @Post("topup")
  async topup(@Req() req: AuthedRequest, @Body() body: unknown) {
    const tenant = requireScope(req.tenant, "wallet:read");
    const parsed = initiateTopUpRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_topup",
        "Provide amount_minor (positive), currency and email.",
      );
    }
    return this.payments.initiate(tenant.id, parsed.data);
  }

  @Get("payment-method")
  async paymentMethod(@Req() req: AuthedRequest) {
    const tenant = requireScope(req.tenant, "wallet:read");
    return this.payments.getSavedMethod(tenant.id);
  }

  @Get("auto-topup")
  async getAutoTopup(@Req() req: AuthedRequest) {
    const tenant = requireScope(req.tenant, "wallet:read");
    return this.autoTopup.getAutoTopup(tenant.id);
  }

  @Put("auto-topup")
  async setAutoTopup(@Req() req: AuthedRequest, @Body() body: unknown) {
    const tenant = requireScope(req.tenant, "wallet:read");
    const parsed = updateAutoTopupRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_auto_topup",
        "Provide enabled, threshold_minor (non-negative), top_up_minor (positive) and currency.",
      );
    }
    return this.autoTopup.updateAutoTopup(tenant.id, parsed.data);
  }
}
