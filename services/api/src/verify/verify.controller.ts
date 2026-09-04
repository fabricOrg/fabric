import {
  type VerifyStartResponse,
  verifyCheckRequest,
  verifyStartRequest,
  verifyStartResponse,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
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
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { replayOrConflict } from "../idempotency/replay-parse.js";
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
  constructor(
    @Inject(VerifyService) private readonly verify: VerifyService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  async start(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<VerifyStartResponse> {
    const tenant = requireScope(req.tenant, "sms:send");
    const parsed = verifyStartRequest.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_verify_request",
        parsed.error.issues[0]?.message ?? "Invalid verification request.",
        String(parsed.error.issues[0]?.path[0] ?? "to"),
      );
    }
    const execute = () =>
      this.verify.start(tenant.id, parsed.data, {
        environmentId: tenant.environmentId,
        applicationId: tenant.applicationId,
      });
    if (idempotencyKey === undefined) return execute();

    const fingerprint = this.idempotency.fingerprint(parsed.data, {
      route: "POST /v1/verify",
      environmentId: tenant.environmentId,
    });
    const claim = await this.idempotency.begin(
      tenant.id,
      idempotencyKey,
      fingerprint,
    );
    if (claim.kind === "replay") return replayedStart(claim.response);

    let response: Awaited<ReturnType<typeof execute>>;
    try {
      response = await execute();
    } catch (error) {
      await this.idempotency.release(tenant.id, idempotencyKey);
      throw error;
    }
    // Never persist the sandbox debug code. A replay can recover the verification reference and
    // expiry; the code remains visible only in the virtual phone/original one-time response.
    const { debug_code: _debugCode, ...replayableResponse } = response;
    await this.idempotency.completeOrLog(
      tenant.id,
      idempotencyKey,
      replayableResponse,
    );
    return response;
  }

  @Get("overview")
  async overview(@Req() req: AuthedRequest) {
    const tenant = requireScope(req.tenant, "sms:read");
    return this.verify.overview(tenant.id);
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

/**
 * A replay hands back the response stored at FIRST execution, so the relative expiry in it is as old
 * as the claim. `expires_at` is absolute and stays true; `expires_in` is recomputed against it so a
 * start replayed four minutes later does not still promise five minutes, and reads 0 once the code
 * has lapsed. Parsed rather than cast: the stored payload crossed a persistence boundary.
 *
 * `status` is deliberately NOT recomputed: it is the status at start, and inferring a live one from
 * an expiry would report `expired` for a code the caller has since verified. The contract says so.
 */
function replayedStart(stored: unknown): VerifyStartResponse {
  // Shared with the four send controllers: a stored payload that no longer matches the contract
  // (written by an earlier release, or by hand) must not escape as a raw ZodError.
  const response = replayOrConflict(verifyStartResponse, stored);
  const remainingMs = Date.parse(response.expires_at) - Date.now();
  return {
    ...response,
    expires_in: Math.max(0, Math.ceil(remainingMs / 1000)),
  };
}
