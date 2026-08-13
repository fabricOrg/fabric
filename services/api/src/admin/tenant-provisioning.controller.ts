import {
  provisionTenantRequestSchema,
  updateSandboxAllowancePolicySchema,
  updateTenantStatusRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
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

  /** Suspend / reinstate / soft-close a tenant. Actor attested by the BFF via x-actor-* headers
   *  (it gates the staff session + staff:write first); recorded to the audit log. */
  @Patch("tenants/:id")
  async updateStatus(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const parsed = updateTenantStatusRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_status_request",
        "Provide a valid status and a reason (at least 8 characters).",
      );
    }
    return this.provisioning.updateStatus(id, parsed.data, {
      email: actorEmail ?? null,
      staffId: actorStaffId ?? null,
    });
  }

  @Get("tenants/:id/sandbox-allowances")
  async sandboxAllowances(@Param("id") id: string) {
    return this.provisioning.sandboxAllowancePolicy(id);
  }

  @Patch("tenants/:id/sandbox-allowances")
  async updateSandboxAllowances(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const parsed = updateSandboxAllowancePolicySchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_sandbox_allowance_policy",
        "Provide a positive daily limit for every channel plus a reason of at least 8 characters.",
      );
    }
    return this.provisioning.updateSandboxAllowancePolicy(id, parsed.data, {
      email: actorEmail ?? null,
      staffId: actorStaffId ?? null,
    });
  }
}
