import { resolveIdentitySessionRequestSchema } from "@app/contracts";
import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireTenant,
} from "../api-keys/api-key.guard.js";
import { forbidden, invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "./bff-token.guard.js";
import { IdentityService } from "./identity.service.js";

interface IdentityRequest {
  tenant?: RequestTenant;
}

@Controller("internal/identity")
@UseGuards(BffTokenGuard, ApiKeyGuard)
export class IdentityController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  @Post("session")
  async resolve(@Req() req: IdentityRequest, @Body() body: unknown) {
    const parsed = resolveIdentitySessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_identity_claims",
        "The identity session claims are invalid.",
      );
    }
    const tenant = requireTenant(req.tenant);
    const resolved = await this.identity.resolve(tenant.id, parsed.data);
    if (!resolved) {
      throw forbidden(
        "identity_not_authorized",
        "This identity is not authorized for the configured workspace.",
      );
    }
    return resolved;
  }
}
