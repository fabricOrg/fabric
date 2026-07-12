import type { ApplicationDto, ListApplicationsResponse } from "@app/contracts";
import { createApplicationRequestSchema } from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { OperatorTokenGuard } from "../api-keys/operator-token.guard.js";
import { invalidRequest } from "../http/api-error.js";
import { ApplicationsService } from "./applications.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Application MANAGEMENT (ADR-0004). List / create applications in a workspace. Mirrors the
 * key-management surface: operator-token-gated with an operator-supplied tenantId until the customer
 * session/BFF supplies it (then tenantId comes from the session, not the request). Input is parsed
 * against the shared zod contract → F8.3 invalid_request_error with a `param`.
 */
@Controller("v1/applications")
@UseGuards(OperatorTokenGuard)
export class ApplicationsController {
  constructor(
    @Inject(ApplicationsService) private readonly svc: ApplicationsService,
  ) {}

  @Get()
  list(
    @Query("tenantId") tenantId: unknown,
  ): Promise<ListApplicationsResponse> {
    return this.svc.list(requireUuid(tenantId, "tenantId"));
  }

  @Post()
  create(@Body() body: unknown): Promise<ApplicationDto> {
    const b = (body ?? {}) as Record<string, unknown>;
    const tenantId = requireUuid(b.tenantId, "tenantId");
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

function requireUuid(value: unknown, param: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw invalidRequest("invalid_uuid", `${param} must be a uuid.`, param);
  }
  return value;
}
