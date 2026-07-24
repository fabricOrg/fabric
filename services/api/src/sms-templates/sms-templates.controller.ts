import {
  createSmsTemplateRequest,
  smsTemplateId,
  updateSmsTemplateRequest,
} from "@app/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { invalidRequest } from "../http/api-error.js";
import { SmsTemplatesService } from "./sms-templates.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/sms/templates")
@UseGuards(ApiKeyGuard)
export class SmsTemplatesController {
  constructor(
    @Inject(SmsTemplatesService)
    private readonly templates: SmsTemplatesService,
  ) {}

  @Get()
  async list(@Req() request: AuthedRequest) {
    const tenant = requireScope(request.tenant, "sms:read");
    return { templates: await this.templates.list(tenant.id) };
  }

  @Post()
  async create(@Req() request: AuthedRequest, @Body() body: unknown) {
    const tenant = requireScope(request.tenant, "sms:send");
    const parsed = createSmsTemplateRequest.safeParse(body);
    if (!parsed.success) throw invalidTemplateRequest(parsed.error);
    return this.templates.create(tenant.id, parsed.data);
  }

  @Patch(":id")
  async update(
    @Req() request: AuthedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const tenant = requireScope(request.tenant, "sms:send");
    requireTemplateId(id);
    const parsed = updateSmsTemplateRequest.safeParse(body);
    if (!parsed.success) throw invalidTemplateRequest(parsed.error);
    return this.templates.update(tenant.id, id, parsed.data);
  }

  @Delete(":id")
  async remove(@Req() request: AuthedRequest, @Param("id") id: string) {
    const tenant = requireScope(request.tenant, "sms:send");
    requireTemplateId(id);
    await this.templates.remove(tenant.id, id);
  }
}

function requireTemplateId(id: string): void {
  if (!smsTemplateId.safeParse(id).success) {
    throw invalidRequest(
      "invalid_sms_template_id",
      "The SMS template id is invalid.",
      "id",
    );
  }
}

function invalidTemplateRequest(error: {
  readonly issues: ReadonlyArray<{
    readonly message: string;
    readonly path: PropertyKey[];
  }>;
}) {
  const issue = error.issues[0];
  return invalidRequest(
    "invalid_sms_template",
    issue?.message ?? "The SMS template is invalid.",
    String(issue?.path[0] ?? "template"),
  );
}
