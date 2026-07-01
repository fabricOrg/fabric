// F8.3 error model — the SHARED error envelope every response carries, plus a browser-safe parser
// the frontend uses to turn an API error into a typed, handleable result. Lives in @app/contracts
// (not fe-auth) because it's the same shape services PRODUCE and the FE CONSUMES — one source of
// truth. MUST stay zod-only / browser-safe (no node:* imports): the FE bundles this package.
//
// Envelope (F8.3): { error: { type, code, message, param?, doc_url? } } + a request_id on every
// response (success and error). See docs/PI-1/E8-developer-experience/F8.3-error-model-request-ids.md

import { z } from "zod";

/** Stable, programmatically-handleable error categories (F8.3). Extend as endpoints add types. */
export const errorType = z.enum([
  "api_error", // 5xx / unexpected server fault
  "auth_error", // 401/403 — bad/missing credentials or insufficient permission
  "invalid_request_error", // 400/422 — malformed or failing validation (see `param`)
  "not_found_error", // 404 — no such resource (e.g. GET /v1/sms/:id unknown id)
  "idempotency_error", // 409 — idempotency-key conflict
  "rate_limit_error", // 429 — quota/rate exceeded
  "insufficient_funds_error", // 402 — wallet balance too low to reserve
]);
export type ErrorType = z.infer<typeof errorType>;

/** The `error` object inside the envelope. `param` pinpoints the offending field; `message` is
 *  user-safe; `doc_url` optionally links the error reference. */
export const apiErrorBody = z.object({
  type: errorType,
  code: z.string(),
  message: z.string(),
  param: z.string().optional(),
  doc_url: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBody>;

/** The full error envelope. `request_id` (`req_…`) is present on every response for traceability;
 *  surface it in error UIs ("contact support with req_…"). */
export const apiErrorEnvelope = z.object({
  error: apiErrorBody,
  request_id: z.string().optional(),
});
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelope>;

/** A normalized, always-safe view for the UI — never throws, always has something to render. */
export interface ParsedApiError {
  readonly type: ErrorType;
  readonly code: string;
  /** User-safe message. Falls back to a generic string if the body was unparseable. */
  readonly message: string;
  readonly param?: string;
  readonly docUrl?: string;
  /** `req_…` if the response carried one — show it in the toast for support. */
  readonly requestId?: string;
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * Parse an unknown API error payload into a typed, renderable result. NEVER throws — an
 * unrecognized shape degrades to a generic `api_error` so the UI always has something safe to show.
 * `requestIdFallback` lets callers pass a request id read from a response header when the body
 * omitted it.
 */
export function parseApiError(
  payload: unknown,
  requestIdFallback?: string,
): ParsedApiError {
  const parsed = apiErrorEnvelope.safeParse(payload);
  if (!parsed.success) {
    return {
      type: "api_error",
      code: "unknown",
      message: GENERIC_MESSAGE,
      ...withRequestId(requestIdFallback),
    };
  }
  const { error, request_id } = parsed.data;
  return {
    type: error.type,
    code: error.code,
    message: error.message,
    ...(error.param !== undefined ? { param: error.param } : {}),
    ...(error.doc_url !== undefined ? { docUrl: error.doc_url } : {}),
    ...withRequestId(request_id ?? requestIdFallback),
  };
}

function withRequestId(id: string | undefined): { requestId?: string } {
  return id !== undefined ? { requestId: id } : {};
}
