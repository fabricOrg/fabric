import type { ApplicationDto, ListApplicationsResponse } from "@app/contracts";
import { createApplicationRequestSchema } from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import { OperatorOrTenantGuard } from "../api-keys/operator-or-tenant.guard.js";
import { invalidRequest } from "../http/api-error.js";
import { ApplicationsService } from "./applications.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuthedRequest {
  tenant?: RequestTenant;
}

/**
 * Application MANAGEMENT (ADR-0004). List / create applications in a workspace.
 *
 * OperatorOrTenantGuard serves two callers on one surface: the customer dashboard's BFF (a tenant
 * token per ADR-0003 → `req.tenant`), and staff/ops (an operator token + an operator-supplied
 * tenantId, the enterprise exception). When a session authenticated (`req.tenant` present) the
 * tenantId is taken from the token and any client-supplied tenantId is ignored — the tenant is
 * never trusted from the request body/query. Input is parsed against the shared zod contract →
 * F8.3 invalid_request_error with a `param`.
 */
@Controller("v1/applications")
@UseGuards(OperatorOrTenantGuard)
export class ApplicationsController {
  constructor(
    @Inject(ApplicationsService) private readonly svc: ApplicationsService,
  ) {}

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query("tenantId") tenantId: unknown,
  ): Promise<ListApplicationsResponse> {
    return this.svc.list(resolveTenantId(req, tenantId));
  }

  @Post()
  create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<ApplicationDto> {
    const b = (body ?? {}) as Record<string, unknown>;
    const tenantId = resolveTenantId(req, b.tenantId);
    // Parse the request shape against the shared contract (name + slug rules live there).
    const parsed = createApplicationRequestSchema.safeParse(b);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw invalidRequest(
        "invalid_application",
        first?.message ?? "Invalid application payload.",
        first?.path.join(".") || undefined,
      );
    }
    return this.svc.create(tenantId, parsed.data);
  }
}

/**
 * Session path → the tenant is the authenticated token's tenant (client input ignored). Operator
 * path (no `req.tenant`) → the operator supplies the tenantId, validated as a uuid.
 */
function resolveTenantId(req: AuthedRequest, supplied: unknown): string {
  if (req.tenant) return req.tenant.id;
  return requireUuid(supplied, "tenantId");
}

function requireUuid(value: unknown, param: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw invalidRequest("invalid_uuid", `${param} must be a uuid.`, param);
  }
  return value;
}
