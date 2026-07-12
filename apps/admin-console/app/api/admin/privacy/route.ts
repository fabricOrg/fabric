import { erasureRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  eraseSubject,
  lookupSubject,
  PrivacyApiError,
} from "@/lib/server/privacy-client";

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

function respond(error: unknown) {
  if (error instanceof PrivacyApiError) {
    return NextResponse.json(error.payload, { status: error.status });
  }
  return fail("request_failed", "Request failed.", 500, "api_error");
}

/** Look up what personal data a workspace holds on a number. staff:read. */
export async function GET(request: NextRequest) {
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);

  const tenantId = request.nextUrl.searchParams.get("tenant_id");
  const msisdn = request.nextUrl.searchParams.get("msisdn");
  if (!tenantId || !msisdn) {
    return fail(
      "invalid_request",
      "Pick a workspace and give a phone number.",
      400,
      "validation_error",
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
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can erase a data subject.",
      403,
    );
  }
  if (!session.email) {
    return fail(
      "actor_required",
      "Your staff account has no email; an erasure must be attributable.",
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const tenantId = (body as { tenant_id?: unknown })?.tenant_id;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return fail(
      "invalid_request",
      "Pick a workspace.",
      422,
      "validation_error",
    );
  }
  const parsed = erasureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      parsed.error.issues[0]?.message ??
        "A valid phone number and legal basis are required.",
      422,
      "validation_error",
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
