import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import {
  queryContractFor,
  requestContractFor,
} from "../openapi/response-contracts.js";
import { invalidRequest } from "./api-error.js";
import {
  checkPayload,
  resolveValidationMode,
  shouldReport,
  type ValidationMode,
} from "./response-validation.js";

/**
 * Checks an incoming body and query string against the contracts the OpenAPI document publishes.
 *
 * THIS IS NOT THE ENFORCEMENT. Thirty-one controllers already parse their own input and raise
 * specific, actionable errors — `invalid_impersonation`, `invalid_scopes`, `invalid_erasure_request`
 * — and those are better messages than anything generic. Replacing them would trade a precise error
 * for a uniform one.
 *
 * What this catches instead is DRIFT between the published contract and what the handler actually
 * accepts: a request the reference says is valid but the handler rejects, or one the handler takes
 * that the reference never described. Both are invisible without a check, and both mislead the
 * person reading the docs — which is the failure this whole pipeline exists to remove.
 *
 * Runs as an interceptor, not a guard, so it sits AFTER authentication. A global guard would run
 * before the route's own guards and would tell an unauthenticated caller whether their body parsed,
 * which is a small but free information leak.
 *
 * Same posture as response validation: throw outside production so drift is found while someone is
 * looking; log in production, where a wrong contract of OURS must not reject a caller's valid
 * request. The handler's own parse still runs either way, so nothing is left unvalidated.
 */
@Injectable()
export class RequestContractInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestContractInterceptor.name);
  private readonly mode: ValidationMode = resolveValidationMode();

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (this.mode !== "off") this.check(context);
    return next.handle();
  }

  private check(context: ExecutionContext): void {
    const controller = context.getClass();
    const handler = context.getHandler();
    const request = context.switchToHttp().getRequest<{
      body?: unknown;
      query?: unknown;
    }>();
    const route = `${controller.name}.${handler.name}`;

    // An absent body on a route that declares one is the handler's error to raise: it owns the
    // "this field is required" message, and duplicating it here would produce two different errors
    // for one mistake.
    if (request.body !== undefined && request.body !== null) {
      this.report(
        checkPayload(
          requestContractFor(controller, handler),
          request.body,
          route,
        ),
        "request body",
      );
    }
    if (request.query !== undefined && request.query !== null) {
      this.report(
        checkPayload(
          queryContractFor(controller, handler),
          request.query,
          route,
        ),
        "query string",
      );
    }
  }

  private report(
    failure: { route: string; issues: string } | null,
    what: string,
  ): void {
    if (!failure) return;
    if (this.mode === "warn") {
      if (shouldReport(`${what}:${failure.route}`)) {
        this.logger.error(
          `${what} does not match its published contract at ${failure.route}: ${failure.issues}`,
        );
      }
      return;
    }
    throw invalidRequest(
      "request_contract_violation",
      `The ${what} does not match the published schema for ${failure.route}: ${failure.issues}`,
    );
  }
}
