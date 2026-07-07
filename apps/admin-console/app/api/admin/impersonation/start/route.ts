import { startImpersonationRequestSchema } from "@app/contracts";
import { sealImpersonation } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_WINDOW_SECONDS,
  impersonationCookiePassword,
  readAdminSession,
  sessionCookieOptions,
} from "@/lib/server/auth";
import { recordImpersonationStart } from "@/lib/server/impersonation-client";

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

/** Start impersonating a tenant: seal a time-boxed claim cookie + audit. staff:write only. */
export async function POST(request: NextRequest) {
  const session = await readAdminSession();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can impersonate.",
      403,
    );
  }
  const password = impersonationCookiePassword();
  if (password.length < 32) {
    return fail(
      "not_configured",
      "Impersonation isn't configured.",
      500,
      "api_error",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = startImpersonationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Pick a tenant and give a reason (≥ 8 chars).",
      422,
      "validation_error",
    );
  }

  const actor = { email: session.email ?? "unknown", staffId: session.userId };
  try {
    await recordImpersonationStart(parsed.data, actor);
  } catch {
    return fail(
      "audit_failed",
      "Couldn't record impersonation. Aborted.",
      502,
      "api_error",
    );
  }

  const expiresAt = Date.now() + IMPERSONATION_WINDOW_SECONDS * 1000;
  const sealed = sealImpersonation(password, {
    targetTenantId: parsed.data.tenant_id,
    targetLabel: parsed.data.tenant_label,
    reason: parsed.data.reason,
    expiresAt,
  });
  const response = NextResponse.json({ ok: true, endsAt: expiresAt });
  response.cookies.set(IMPERSONATION_COOKIE, sealed, {
    ...sessionCookieOptions(),
    maxAge: IMPERSONATION_WINDOW_SECONDS,
  });
  return response;
}
