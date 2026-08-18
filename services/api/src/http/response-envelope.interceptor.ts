import type { IncomingMessage } from "node:http";
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";
import {
  envelopeDisabledFor,
  responseContractFor,
  successContentTypeFor,
} from "../openapi/response-contracts.js";
import { apiError } from "./api-error.js";
import { resolveRequestId } from "./logging.config.js";
import {
  checkPayload,
  resolveValidationMode,
  shouldReport,
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
        // 204 and other empty bodies have nothing to validate or wrap.
        if (payload === undefined || payload === null) return payload;

        // VALIDATION IS INDEPENDENT OF WRAPPING. These used to be one decision, so a route that
        // opted out of the envelope — `envelope: false`, or a declared non-JSON media type — was
        // documented with a response schema that was never once checked against a real payload.
        // Publishing a shape and not enforcing it is the precise failure this interceptor exists
        // to prevent, and it applied to `GET /docs/openapi.json`: the document describing every
        // contract was itself the one response nobody verified.
        this.validate(context, payload);

        // NON-JSON PASSES THROUGH UNWRAPPED. The statement export sets `text/csv` and a download
        // filename; the Meta handshake echoes a bare challenge string it will compare verbatim.
        // Wrapping either corrupts it — a spreadsheet becomes an object, and Meta rejects the
        // subscription. Detected from the binding first, then the response's own content-type.
        if (!this.isJson(context, http.getResponse())) return payload;

        return {
          data: payload,
          request_id: requestIdOf(request),
        };
      }),
    );
  }

  /**
   * Whether this response should be enveloped.
   *
   * THE BINDING IS AUTHORITATIVE, not the header. Fastify only stamps a content-type during
   * `reply.send()`, which runs AFTER this interceptor — so a handler that returns a bare string
   * without an explicit `@Header` still looks like JSON here. That is precisely how the Meta
   * challenge echo came to be wrapped despite its binding declaring `text/plain`.
   *
   * The header is still consulted, for a handler that sets one at runtime (the CSV export does) and
   * for routes with no binding at all.
   */
  private isJson(context: ExecutionContext, response: unknown): boolean {
    // An explicit opt-out wins over every inference. `GET /docs/openapi.json` returns JSON that
    // must stay a bare OpenAPI document — no media type distinguishes it, so nothing inferred from
    // headers or content types could have caught it.
    if (envelopeDisabledFor(context.getClass(), context.getHandler()))
      return false;
    const declared = successContentTypeFor(
      context.getClass(),
      context.getHandler(),
    );
    if (declared) return declared.includes("application/json");
    return isJsonResponse(response);
  }

  /** See response-validation.ts for why the posture differs by environment. */
  private validate(context: ExecutionContext, payload: unknown): void {
    if (this.mode === "off") return;
    const contract = responseContractFor(
      context.getClass(),
      context.getHandler(),
    );
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const failure = checkPayload(contract, payload, route);
    if (!failure) return;
    if (this.mode === "warn") {
      // Rate-limited per route: a systematically-wrong contract would otherwise emit one ERROR per
      // request forever. See shouldReport.
      if (shouldReport(failure.route)) {
        this.logger.error(
          `response does not match its published contract at ${failure.route}: ${failure.issues}`,
        );
      }
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
  // `resolveRequestId` wants `Pick<IncomingMessage, "headers">`, whose index signature is narrower
  // than what Fastify hands us. Widening the ARGUMENT type is the honest form; the `as unknown as`
  // that used to sit here bypassed the check rather than satisfying it, and this file is otherwise
  // cast-free.
  return resolveRequestId({
    headers: request.headers as IncomingMessage["headers"],
  });
}
