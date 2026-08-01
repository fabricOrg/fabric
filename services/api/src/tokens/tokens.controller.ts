import { purchaseCommercialOfferRequestSchema } from "@app/contracts";
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
import { forbidden, invalidRequest } from "../http/api-error.js";
import { listTokenBalances } from "./token-grant.js";
import { TokenPurchaseService } from "./token-purchase.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/**
 * Tenant-facing token entitlements and commercial-offer checkout. The BFF supplies a wildcard
 * tenant token only after its owner/admin role gate; customer API keys remain limited to the closed
 * public scope catalog. Phase 4 adds the dashboard purchase experience over this boundary.
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
    const tenant = requirePurchaseSession(req.tenant);
    const parsed = purchaseCommercialOfferRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_token_purchase",
        "Provide a published offer version, valid pack count, and email.",
      );
    }
    return this.purchases.initiate(tenant.id, parsed.data);
  }
}

function requirePurchaseSession(
  tenant: RequestTenant | undefined,
): RequestTenant {
  const resolved = requireScope(tenant, "wallet:read");
  if (!resolved.isSessionToken) {
    throw forbidden(
      "token_purchase_requires_session",
      "Commercial offers can only be purchased from a dashboard session, not an API key.",
    );
  }
  return resolved;
}
