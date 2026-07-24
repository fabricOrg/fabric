import { randomBytes } from "node:crypto";
import type { ApiErrorEnvelope, ErrorType } from "@app/contracts";
import { InsufficientFundsError } from "@app/wallet";
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

/** 403 in the F8.3 envelope - authenticated but missing the endpoint permission. */
export function forbidden(code: string, message: string): HttpException {
  return apiError({ type: "auth_error", code, message, status: 403 });
}

/** 400 in the F8.3 envelope (`type: "invalid_request_error"`) — `param` pinpoints the bad field. */
export function invalidRequest(
  code: string,
  message: string,
  param?: string,
): HttpException {
  return apiError({
    type: "invalid_request_error",
    code,
    message,
    status: 400,
    ...(param !== undefined ? { param } : {}),
  });
}

/** 404 in the F8.3 envelope (`type: "not_found_error"`). */
export function notFound(code: string, message: string): HttpException {
  return apiError({ type: "not_found_error", code, message, status: 404 });
}

/**
 * 402 in the F8.3 envelope (`type: "insufficient_funds_error"`) — the wallet can't cover the
 * reserve. The money path fails CLOSED, so this is thrown before any provider contact or persisted
 * effect. Without this the wallet's `InsufficientFundsError` escapes as an opaque 500 and the SDK
 * can't branch on it, even though the contract has always declared the category.
 */
export function insufficientFunds(
  code: string,
  message: string,
): HttpException {
  return apiError({
    type: "insufficient_funds_error",
    code,
    message,
    status: 402,
  });
}

/**
 * Rethrow helper for a `.catch()` at an HTTP boundary: converts the wallet's balance rejection into
 * the 402 envelope and passes every other error through untouched.
 *
 * Deliberately applied at the boundary rather than inside the services, so they keep throwing the
 * DOMAIN error and callers like `ManagedMessagesService` can still branch on it.
 */
export function asInsufficientFunds(error: unknown, message: string): never {
  if (error instanceof InsufficientFundsError) {
    throw insufficientFunds("insufficient_funds", message);
  }
  throw error;
}

/** 429 in the F8.3 envelope (`type: "rate_limit_error"`) — back off and retry. */
export function tooManyRequests(code: string, message: string): HttpException {
  return apiError({ type: "rate_limit_error", code, message, status: 429 });
}
