import type {
  ListMessageDefinitionsResponse,
  MessageDefinitionState,
} from "@app/contracts";
import {
  addMessageDefinitionVersionRequest,
  createMessageDefinitionRequest,
  publishMessageDefinitionRequest,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import { OperatorOrTenantGuard } from "../api-keys/operator-or-tenant.guard.js";
import { forbidden, invalidRequest } from "../http/api-error.js";
import { MessageDefinitionsService } from "./message-definitions.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuthedRequest {
  tenant?: RequestTenant;
}

/**
 * Managed message definition MANAGEMENT surface (SDK-003 slice 4). Authoring/publishing requires a
 * dashboard SESSION or an operator — NOT a data-plane `sk_*` key (ADR-0005 #6, least privilege).
 * OperatorOrTenantGuard admits the operator path (no `req.tenant`) and the ApiKeyGuard path; we then
 * reject the ApiKeyGuard path when it came from a scoped `sk_*` key (its `applicationId` is set — the
 * BFF tenant token leaves it null). The tenant id is always taken from the token, never the client.
 */
@Controller("v1/message-definitions")
@UseGuards(OperatorOrTenantGuard)
export class MessageDefinitionsController {
  constructor(
    @Inject(MessageDefinitionsService)
    private readonly svc: MessageDefinitionsService,
  ) {}

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query("tenantId") tenantId: unknown,
    @Query("applicationId") applicationId: unknown,
  ): Promise<ListMessageDefinitionsResponse> {
    const tid = resolveManagementTenant(req, tenantId);
    return this.svc.list(
      tid,
      typeof applicationId === "string" ? applicationId : undefined,
    );
  }

  @Post()
  create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<MessageDefinitionState> {
    const b = (body ?? {}) as Record<string, unknown>;
    const tid = resolveManagementTenant(req, b.tenantId);
    const parsed = createMessageDefinitionRequest.safeParse(b);
    if (!parsed.success) throw fromZod(parsed.error, "invalid_definition");
    return this.svc.create(tid, parsed.data);
  }

  @Post(":id/versions")
  addVersion(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<MessageDefinitionState> {
    const b = (body ?? {}) as Record<string, unknown>;
    const tid = resolveManagementTenant(req, b.tenantId);
    const parsed = addMessageDefinitionVersionRequest.safeParse(b);
    if (!parsed.success) throw fromZod(parsed.error, "invalid_version");
    return this.svc.addVersion(tid, id, parsed.data);
  }

  @Post(":id/publish")
  publish(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<MessageDefinitionState> {
    const b = (body ?? {}) as Record<string, unknown>;
    const tid = resolveManagementTenant(req, b.tenantId);
    const parsed = publishMessageDefinitionRequest.safeParse(b);
    if (!parsed.success) throw fromZod(parsed.error, "invalid_publish");
    return this.svc.publish(tid, id, parsed.data, actorKeyId(req));
  }

  @Post(":id/archive")
  async archive(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ archived: true }> {
    const b = (body ?? {}) as Record<string, unknown>;
    const tid = resolveManagementTenant(req, b.tenantId);
    await this.svc.archive(tid, id, actorKeyId(req));
    return { archived: true };
  }
}

/**
 * Management authority: operator (no `req.tenant`) supplies the tenantId; a dashboard session (BFF
 * tenant token → `applicationId === null`) uses its own tenant. A scoped `sk_*` runtime key
 * (`applicationId` set) is rejected — runtime keys must not author/publish definitions.
 */
function resolveManagementTenant(
  req: AuthedRequest,
  supplied: unknown,
): string {
  if (!req.tenant) return requireUuid(supplied, "tenantId");
  if (req.tenant.applicationId !== null) {
    throw forbidden(
      "management_requires_session",
      "Message definitions can only be managed from a dashboard session, not an API key.",
    );
  }
  return req.tenant.id;
}

function actorKeyId(req: AuthedRequest): string {
  return req.tenant?.keyId ?? "operator";
}

function fromZod(
  error: { issues: ReadonlyArray<{ message: string; path: PropertyKey[] }> },
  code: string,
): ReturnType<typeof invalidRequest> {
  const first = error.issues[0];
  return invalidRequest(
    code,
    first?.message ?? "Invalid payload.",
    first?.path.map(String).join(".") || undefined,
  );
}

function requireUuid(value: unknown, param: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw invalidRequest("invalid_uuid", `${param} must be a uuid.`, param);
  }
  return value;
}
