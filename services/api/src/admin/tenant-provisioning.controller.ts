import { provisionTenantRequestSchema } from "@app/contracts";
import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";

/**
 * Staff/internal control-plane endpoint. Guarded by the BFF token (called by the admin-console
 * server, never a browser). Not tenant-scoped, so no ApiKeyGuard.
 */
@Controller("internal/admin")
@UseGuards(BffTokenGuard)
export class TenantProvisioningController {
  constructor(
    @Inject(TenantProvisioningService)
    private readonly provisioning: TenantProvisioningService,
  ) {}

  @Post("tenants")
  async create(@Body() body: unknown) {
    const parsed = provisionTenantRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_tenant_request",
        "The tenant provisioning request is invalid.",
      );
    }
    return this.provisioning.provision(parsed.data);
  }
}
