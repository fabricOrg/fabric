import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  type Actor,
  CommercialOfferApiError,
} from "@/lib/server/commercial-offers-client";
import { requireTrustedOrigin } from "@/lib/server/origin";

/**
 * Shared plumbing for the commercial-offer BFF routes: trusted origin, staff session (with the refresh
 * fallback a mutation route needs — a plain read 401s once the short-lived WorkOS token lapses),
 * `staff:write`, body parsing, and error passthrough.
 *
 * It exists because these seven routes differ only in which client call they make; duplicating the
 * gate seven times is how one of them eventually ships without it.
 */

export function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
): NextResponse {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

/**
 * The api rejects an unattributed write, so an actor is resolved here or the request never leaves.
 * `schema` is the request contract — pass null for actions that carry no body (a clone).
 */
export async function withStaffWrite<T>(
  request: NextRequest,
  schema: ZodType<T> | null,
  handler: (actor: Actor, body: T) => Promise<unknown>,
): Promise<NextResponse> {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can author commercial pricing.",
      403,
    );
  }
  // `userId` on a staff session is the `staff_users` row id — the same value the audit log records,
  // and what the api's `created_by` / `approved_by` foreign keys point at.
  const actor: Actor = {
    email: session.email ?? "unknown",
    staffId: session.userId,
  };

  let parsed: T;
  if (schema) {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return fail(
        "invalid_request",
        "Malformed body.",
        400,
        "validation_error",
      );
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      return fail(
        "invalid_request",
        result.error.issues[0]?.message ?? "Invalid request.",
        422,
        "validation_error",
      );
    }
    parsed = result.data;
  } else {
    parsed = undefined as T;
  }

  try {
    return NextResponse.json(await handler(actor, parsed));
  } catch (error) {
    return toResponse(error);
  }
}

/** Read path — any staff session may look at the catalog; only writes need `staff:write`. */
export async function withStaffRead(
  handler: () => Promise<unknown>,
): Promise<NextResponse> {
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  try {
    return NextResponse.json(await handler());
  } catch (error) {
    return toResponse(error);
  }
}

/**
 * The api's structured error is passed through UNCHANGED, status and code included. Flattening it to a
 * 502 would replace a sentence staff can act on ("another staff admin must publish it", "the worst
 * permitted route leaves 1300 bps against a 2000 bps floor") with "something went wrong".
 */
function toResponse(error: unknown): NextResponse {
  if (error instanceof CommercialOfferApiError) {
    return NextResponse.json(error.payload, { status: error.status });
  }
  return fail(
    "commercial_offers_unavailable",
    "The pricing service is unavailable.",
    502,
    "api_error",
  );
}
