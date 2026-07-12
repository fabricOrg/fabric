import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { unauthorized } from "../http/api-error.js";
import { readSingleHeader, secretsMatch } from "../http/shared-secret.js";
import { ApiKeyGuard } from "./api-key.guard.js";

/** Minimal shape we read — avoids coupling to a specific HTTP adapter's request type. */
interface HeaderRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Management-surface auth (ADR-0004). A request is authorized by EITHER of two paths, letting one
 * controller serve both the staff/ops flow and the customer dashboard:
 *
 *  - OPERATOR path — a valid `x-operator-token` (staff/ops). `req.tenant` stays undefined; the
 *    handler reads the operator-supplied tenantId from the query/body. Cross-tenant by design.
 *  - CUSTOMER path — a credential ApiKeyGuard accepts (the BFF's short-lived tenant token per
 *    ADR-0003, or an `sk_*` key). ApiKeyGuard attaches `req.tenant`; the handler derives the
 *    tenantId from `req.tenant.id`, NEVER from the client.
 *
 * If the operator header is present it MUST be valid (no silent fall-through to a confusing
 * customer-path 401); absent → the ApiKeyGuard path runs and throws its own 401 on failure.
 */
@Injectable()
export class OperatorOrTenantGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ApiKeyGuard) private readonly apiKeyGuard: ApiKeyGuard,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const req = context.switchToHttp().getRequest<HeaderRequest>();
    const operator = readSingleHeader(req.headers["x-operator-token"]);
    if (operator !== null) {
      const expected = this.config.get<string>("OPERATOR_TOKEN") ?? "";
      if (!secretsMatch(operator, expected)) {
        throw unauthorized(
          "invalid_operator_token",
          "A valid operator token is required.",
        );
      }
      return true;
    }
    // No operator token → customer path. ApiKeyGuard attaches req.tenant (tenant token or sk_* key)
    // or throws a 401 auth_error of its own.
    return this.apiKeyGuard.canActivate(context);
  }
}
