import { verifyCheckRequest, verifyStartRequest } from "@app/contracts";
import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { invalidRequest } from "../http/api-error.js";
import { VerifyService } from "./verify.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/**
 * Verify (OTP) public surface — POST /v1/verify (start) + /v1/verify/check. Scope: `sms:send`,
 * deliberately — a V1 verification IS an SMS send (its billing basis too); a dedicated
 * verify:* scope arrives with per-verification pricing. BFF tenant tokens (wildcard) pass.
 */
@Controller("v1/verify")
@UseGuards(ApiKeyGuard)
export class VerifyController {
  constructor(@Inject(VerifyService) private readonly verify: VerifyService) {}

  @Post()
  async start(@Req() req: AuthedRequest, @Body() body: unknown) {
    const tenant = requireScope(req.tenant, "sms:send");
    const parsed = verifyStartRequest.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_verify_request",
        parsed.error.issues[0]?.message ?? "Invalid verification request.",
        String(parsed.error.issues[0]?.path[0] ?? "to"),
      );
    }
    return this.verify.start(tenant.id, parsed.data);
  }

  @Post("check")
  async check(@Req() req: AuthedRequest, @Body() body: unknown) {
    const tenant = requireScope(req.tenant, "sms:send");
    const parsed = verifyCheckRequest.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_verify_check",
        parsed.error.issues[0]?.message ?? "Invalid check request.",
        String(parsed.error.issues[0]?.path[0] ?? "code"),
      );
    }
    return this.verify.check(tenant.id, parsed.data);
  }
}
