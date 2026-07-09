import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { pageOpts } from "../http/pagination.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { AuditService } from "./audit.service.js";

/** Audit log read endpoint for the admin-console BFF. BffToken-guarded (staff-only control plane). */
@Controller("internal/admin/audit")
@UseGuards(BffTokenGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  async list(@Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.audit.list(pageOpts(limit, cursor));
  }
}
