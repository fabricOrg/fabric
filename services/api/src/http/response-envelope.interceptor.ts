import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { responseContractFor } from "../openapi/response-contracts.js";
import { apiError } from "./api-error.js";
import { resolveRequestId } from "./logging.config.js";
import {
  checkResponse,
  resolveValidationMode,
  type ValidationMode,
} from "./response-validation.js";

/**
 * Wraps every successful JSON response in `{ data, request_id }`.
 *
 * DONE HERE RATHER THAN IN 140 HANDLERS on purpose. A convention each handler has to remember is a
 * convention that decays — that is precisely how this API ended up with a resource at the top
 * level, several named collection keys, a bare array, and four acknowledgement literals. As an
 * interceptor the shape is uniform BY CONSTRUCTION: a new controller cannot forget it, and the
 * OpenAPI generator applies the same wrap to every response schema, so the document cannot drift
 * from the runtime either.
 *
 * Errors are untouched — they already carry `{ error, request_id }` from `apiError`, and passing a
 * thrown exception through here would double-wrap it.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseEnvelopeInterceptor.name);
  // Resolved once: the mode cannot change without a restart, and reading env per response would
  // put a lookup on every request for a value that never moves.
  private readonly mode: ValidationMode = resolveValidationMode();

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      id?: unknown;
      url?: string;
      headers: Record<string, string | string[] | undefined>;
    }>();

    return next.handle().pipe(
      map((payload) => {
        // NON-JSON PASSES THROUGH UNTOUCHED. The statement export sets `text/csv` and a download
        // filename; the Meta handshake echoes a bare challenge string it will compare verbatim.
        // Wrapping either corrupts it — a spreadsheet becomes an object, and Meta rejects the
        // subscription. Detected from the response's own content-type, set by the handler.
        if (!isJsonResponse(http.getResponse())) return payload;
        // 204 and other empty bodies have nothing to wrap.
        if (payload === undefined || payload === null) return payload;
        this.validate(context, payload);
        return {
          data: payload,
          request_id: requestIdOf(request),
        };
      }),
    );
  }

  /** See response-validation.ts for why the posture differs by environment. */
  private validate(context: ExecutionContext, payload: unknown): void {
    if (this.mode === "off") return;
    const contract = responseContractFor(
      context.getClass(),
      context.getHandler(),
    );
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const failure = checkResponse(contract, payload, route);
    if (!failure) return;
    if (this.mode === "warn") {
      this.logger.error(
        `response does not match its published contract at ${failure.route}: ${failure.issues}`,
      );
      return;
    }
    // strict: a mismatch is a defect and the reference is meant to be trustworthy.
    throw apiError({
      type: "api_error",
      code: "response_contract_violation",
      message: `The response from ${failure.route} does not match its published schema: ${failure.issues}`,
      status: 500,
    });
  }
}

function isJsonResponse(response: unknown): boolean {
  const header = (
    response as { getHeader?: (name: string) => unknown }
  ).getHeader?.("content-type");
  const value = Array.isArray(header) ? header[0] : header;
  // Absent content-type means Fastify has not been told otherwise, and its default for an object
  // return is JSON — so absence is the JSON case, not the unknown case.
  if (typeof value !== "string") return true;
  return value.includes("application/json");
}

/** Reuses the id Fastify already minted for the request, so logs and responses agree. */
function requestIdOf(request: {
  id?: unknown;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  if (typeof request.id === "string" && request.id.length > 0)
    return request.id;
  return resolveRequestId(
    request as unknown as Parameters<typeof resolveRequestId>[0],
  );
}
