import { provisionTenantRequestSchema } from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { pageOpts } from "../http/pagination.js";
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

  @Get("tenants")
  async list(@Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.provisioning.list(pageOpts(limit, cursor));
  }

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
