import {
  createWorkspaceRequestSchema,
  mintTenantTokenRequestSchema,
  resolveUserSessionRequestSchema,
} from "@app/contracts";
import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { TenantTokenService } from "../api-keys/tenant-token.service.js";
import { forbidden, invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "./bff-token.guard.js";
import { IdentityService } from "./identity.service.js";
import { UserSessionService } from "./user-session.service.js";
import { WorkspaceProvisioningService } from "./workspace-provisioning.service.js";

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
    @Inject(UserSessionService)
    private readonly userSessions: UserSessionService,
    @Inject(WorkspaceProvisioningService)
    private readonly workspaces: WorkspaceProvisioningService,
  ) {}

  /** ADR-0007 resolve-v2: user-level session — memberships come back as a list; no org input. */
  @Post("session-v2")
  async resolveUser(@Body() body: unknown) {
    const parsed = resolveUserSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_identity_claims",
        "The identity session claims are invalid.",
      );
    }
    const resolved = await this.userSessions.resolve(parsed.data);
    if (!resolved) {
      throw forbidden(
        "identity_not_authorized",
        "This identity is not recognized and could not be signed in.",
      );
    }
    return resolved;
  }

  /** ADR-0007: onboarding submit — local-only workspace creation (no WorkOS org). */
  @Post("workspaces")
  async createWorkspace(@Body() body: unknown) {
    const parsed = createWorkspaceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_workspace_request",
        "The workspace creation request is invalid.",
      );
    }
    const created = await this.workspaces.createWorkspace(parsed.data);
    if (!created) {
      throw forbidden(
        "workspace_creation_refused",
        "Workspace creation is not available for this identity right now.",
      );
    }
    return created;
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
