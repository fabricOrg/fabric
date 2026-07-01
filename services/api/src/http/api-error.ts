import { randomBytes } from "node:crypto";
import type { ApiErrorEnvelope, ErrorType } from "@app/contracts";
import { HttpException, type HttpStatus } from "@nestjs/common";

/**
 * F8.3 error envelope at the HTTP boundary. Every error response carries
 * `{ error: { type, code, message, param?, doc_url? }, request_id }` — the SAME shape @app/contracts
 * defines and the FE/SDK parse (parseApiError). We throw a Nest HttpException whose response body IS
 * the envelope, so Nest's default filter serializes it verbatim. (A global request-id interceptor for
 * SUCCESS responses is separate F8.3 infra; here we stamp one on the error.)
 */

/** `req_…` correlation id — surfaced in the envelope so support can trace a specific request. */
export function newRequestId(): string {
  return `req_${randomBytes(16).toString("base64url")}`;
}

interface ApiErrorInit {
  readonly type: ErrorType;
  readonly code: string;
  readonly message: string;
  readonly status: HttpStatus;
  readonly param?: string;
  readonly docUrl?: string;
  readonly requestId?: string;
}

/** Build a Nest HttpException whose body is the F8.3 envelope. */
export function apiError(init: ApiErrorInit): HttpException {
  const body: ApiErrorEnvelope = {
    error: {
      type: init.type,
      code: init.code,
      message: init.message,
      ...(init.param !== undefined ? { param: init.param } : {}),
      ...(init.docUrl !== undefined ? { doc_url: init.docUrl } : {}),
    },
    request_id: init.requestId ?? newRequestId(),
  };
  return new HttpException(body, init.status);
}

/** 401 in the F8.3 envelope (`type: "auth_error"`) — bad/missing API key. */
export function unauthorized(code: string, message: string): HttpException {
  return apiError({ type: "auth_error", code, message, status: 401 });
}
