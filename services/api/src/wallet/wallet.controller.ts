import type { WalletSnapshot } from "@app/contracts";
import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { newRequestId } from "../http/api-error.js";
import { WalletQueryService } from "./wallet-query.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/wallet")
@UseGuards(ApiKeyGuard)
export class WalletController {
  constructor(
    @Inject(WalletQueryService)
    private readonly wallet: WalletQueryService,
  ) {}

  @Get()
  async get(@Req() req: AuthedRequest): Promise<WalletSnapshot> {
    const tenant = requireScope(req.tenant, "wallet:read");
    const snapshot = await this.wallet.getSnapshot(tenant.id);
    return { ...snapshot, request_id: newRequestId() };
  }
}
