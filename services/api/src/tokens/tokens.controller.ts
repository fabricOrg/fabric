import { purchaseTokensRequestSchema } from "@app/contracts";
import type { AppDb } from "@app/db";
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest } from "../http/api-error.js";
import { listTokenBalances } from "./token-grant.js";
import { TokenPurchaseService } from "./token-purchase.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/**
 * Tenant-facing token entitlements (ADR-0010 Phase 2). Scoped to `wallet:read` like the top-up
 * endpoints — tokens are the other half of how an account pays for sends, so the same billing
 * authority governs both.
 *
 * There is no dashboard buy-flow yet (that is Phase 3); this is the API surface it will call.
 */
@Controller("v1/tokens")
@UseGuards(ApiKeyGuard)
export class TokensController {
  constructor(
    @Inject(TokenPurchaseService)
    private readonly purchases: TokenPurchaseService,
    @Inject(APP_DB) private readonly db: AppDb,
  ) {}

  @Get()
  async balances(@Req() req: AuthedRequest) {
    const tenant = requireScope(req.tenant, "wallet:read");
    return {
      balances: await this.db.withTenant(tenant.id, (tx) =>
        listTokenBalances(tx),
      ),
    };
  }

  @Post("purchase")
  async purchase(@Req() req: AuthedRequest, @Body() body: unknown) {
    const tenant = requireScope(req.tenant, "wallet:read");
    const parsed = purchaseTokensRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_token_purchase",
        "Provide channel, a positive quantity, currency and email.",
      );
    }
    return this.purchases.initiate(tenant.id, parsed.data);
  }
}
