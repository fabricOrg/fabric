import "server-only";

import { errorEnvelope } from "@app/contracts";
import { NextResponse } from "next/server";

/**
 * Refusals this app's route handlers raise ON THEIR OWN AUTHORITY — no staff session, a body that
 * does not parse, an action this operator may not take. A forwarded API failure is different and
 * must keep its upstream envelope verbatim: each `*ApiError.payload` already IS one, complete with
 * the API's `request_id`.
 *
 * A copy of the dashboard's file rather than a shared module: this app has no shared transport at
 * all (twelve `lib/server/*-client.ts` modules call `fetch` directly), and the two would have to be
 * reconciled onto one `internalApi()` helper before a common home is the right shape. The part that
 * could actually drift — the envelope itself — is shared already, in `@app/contracts`.
 *
 * The names and the status/type pairing mirror `services/api/src/http/api-error.ts` deliberately.
 * One concept, one implementation: a caller cannot tell whether a 403 came from the route handler or
 * from the API, so the two must not describe themselves differently.
 *
 * Every `code` here is a value the UI is allowed to branch on, so it is part of the contract — pick
 * a stable one and do not reword it to improve the message. The MESSAGE is what the user reads and
 * can change freely.
 */
function envelopeResponse(
  status: number,
  init: Parameters<typeof errorEnvelope>[0],
): NextResponse {
  return NextResponse.json(errorEnvelope(init), { status });
}

/** 401 — no staff session, or one that could not be refreshed. */
export function bffUnauthorized(code: string, message: string): NextResponse {
  return envelopeResponse(401, { type: "auth_error", code, message });
}

/** 403 — a staff session that does not clear this route's gate. */
export function bffForbidden(code: string, message: string): NextResponse {
  return envelopeResponse(403, { type: "auth_error", code, message });
}

/** 400 — the request body or query failed to parse. `param` names the offending field. */
export function bffInvalidRequest(
  code: string,
  message: string,
  param?: string,
): NextResponse {
  return envelopeResponse(400, {
    type: "invalid_request_error",
    code,
    message,
    ...(param !== undefined ? { param } : {}),
  });
}

/**
 * 422 — well-formed but rejected on its content (a session with no email to pay with, a quantity
 * the offer does not allow). Same `type` as a 400: the contract puts 400 and 422 in one category
 * (`invalid_request_error`) and nothing in either app branches on the status.
 */
export function bffUnprocessable(
  code: string,
  message: string,
  param?: string,
): NextResponse {
  return envelopeResponse(422, {
    type: "invalid_request_error",
    code,
    message,
    ...(param !== undefined ? { param } : {}),
  });
}

/** 404 — no such resource, or a path parameter that names no known action. */
export function bffNotFound(code: string, message: string): NextResponse {
  return envelopeResponse(404, { type: "not_found_error", code, message });
}

/**
 * The route itself failed in a way that is not an upstream API error. `status` is 500 by default;
 * pass one where the route is reporting that a DEPENDENCY is unreachable (502) or deliberately
 * switched off (503), or is echoing the upstream status alongside its own message.
 */
export function bffFailure(
  code: string,
  message: string,
  status = 500,
): NextResponse {
  return envelopeResponse(status, { type: "api_error", code, message });
}
