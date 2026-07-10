import {
  mintTenantTokenRequestSchema,
  organizationForUserRequestSchema,
  resolveIdentitySessionRequestSchema,
} from "@app/contracts";
import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { TenantTokenService } from "../api-keys/tenant-token.service.js";
import { forbidden, invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "./bff-token.guard.js";
import { IdentityService } from "./identity.service.js";
import { SelfServeProvisioningService } from "./self-serve-provisioning.service.js";

/**
 * BFF-internal identity plane (ADR-0003). Both routes trust BFF_INTERNAL_TOKEN as the service
 * credential; the tenant binding comes from data the BFF verified server-side (the sealed WorkOS
 * session's organization_id, or the tenant id a prior /session resolution returned) — no
 * tenant-bound API key, so runtime-provisioned tenants work immediately.
 */
@Controller("internal/identity")
@UseGuards(BffTokenGuard)
export class IdentityController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(TenantTokenService)
    private readonly tenantTokens: TenantTokenService,
    @Inject(SelfServeProvisioningService)
    private readonly selfServe: SelfServeProvisioningService,
  ) {}

  @Post("session")
  async resolve(@Body() body: unknown) {
    const parsed = resolveIdentitySessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_identity_claims",
        "The identity session claims are invalid.",
      );
    }
    const resolved = await this.identity.resolve(parsed.data);
    if (!resolved) {
      throw forbidden(
        "identity_not_authorized",
        "This identity is not authorized for the configured workspace.",
      );
    }
    return resolved;
  }

  @Post("organization-for-user")
  async organizationForUser(@Body() body: unknown) {
    const parsed = organizationForUserRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_organization_lookup",
        "The organization lookup claims are invalid.",
      );
    }
    const resolved = await this.selfServe.organizationForUser(parsed.data);
    if (!resolved) {
      throw forbidden(
        "no_organization",
        "This identity has no workspace and self-serve sign-up did not apply.",
      );
    }
    return resolved;
  }

  @Post("tenant-token")
  async mintTenantToken(@Body() body: unknown) {
    const parsed = mintTenantTokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_tenant_token_request",
        "A tenant_id is required.",
      );
    }
    // Active tenants only — suspension cuts off fresh BFF credentials within one token TTL.
    if (!(await this.identity.isActiveTenant(parsed.data.tenant_id))) {
      throw forbidden(
        "tenant_not_active",
        "Tenant tokens are only minted for active tenants.",
      );
    }
    const minted = this.tenantTokens.mint(parsed.data.tenant_id);
    return { token: minted.token, expires_in: minted.expiresIn };
  }
}
