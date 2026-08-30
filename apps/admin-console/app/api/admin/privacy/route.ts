import { erasureRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  eraseSubject,
  lookupSubject,
  PrivacyApiError,
} from "@/lib/server/privacy-client";

function respond(error: unknown) {
  if (error instanceof PrivacyApiError) {
    return NextResponse.json(error.payload, { status: error.status });
  }
  return bffFailure("request_failed", "Request failed.");
}

/** Look up what personal data a workspace holds on a number. staff:read. */
export async function GET(request: NextRequest) {
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");

  const tenantId = request.nextUrl.searchParams.get("tenant_id");
  const msisdn = request.nextUrl.searchParams.get("msisdn");
  if (!tenantId || !msisdn) {
    return bffInvalidRequest(
      "invalid_request",
      "Pick a workspace and give a phone number.",
    );
  }
  try {
    return NextResponse.json(await lookupSubject(tenantId, msisdn));
  } catch (error) {
    return respond(error);
  }
}

/**
 * Crypto-shred everything a workspace holds on a number. IRREVERSIBLE.
 *
 * staff:write only, and the acting staff member comes from the authenticated session — an erasure
 * that cannot be attributed to a person is not one we are willing to perform.
 */
export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can erase a data subject.",
    );
  }
  if (!session.email) {
    return bffForbidden(
      "actor_required",
      "Your staff account has no email; an erasure must be attributable.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const tenantId = (body as { tenant_id?: unknown })?.tenant_id;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return bffUnprocessable("invalid_request", "Pick a workspace.");
  }
  const parsed = erasureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      parsed.error.issues[0]?.message ??
        "A valid phone number and legal basis are required.",
    );
  }

  try {
    return NextResponse.json(
      await eraseSubject(tenantId, parsed.data, session.email),
    );
  } catch (error) {
    return respond(error);
  }
}
