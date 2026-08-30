import { startImpersonationRequestSchema } from "@app/contracts";
import { sealImpersonation } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_WINDOW_SECONDS,
  impersonationCookiePassword,
  readAdminSessionWithRefresh,
  sessionCookieOptions,
} from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { recordImpersonationStart } from "@/lib/server/impersonation-client";
import { requireTrustedOrigin } from "@/lib/server/origin";

/** Start impersonating a tenant: seal a time-boxed claim cookie + audit. staff:write only. */
export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can impersonate.",
    );
  }
  const password = impersonationCookiePassword();
  if (password.length < 32) {
    return bffFailure("not_configured", "Impersonation isn't configured.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = startImpersonationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      "Pick a tenant and give a reason (≥ 8 chars).",
    );
  }

  const actor = { email: session.email ?? "unknown", staffId: session.userId };
  try {
    await recordImpersonationStart(parsed.data, actor);
  } catch {
    return bffFailure(
      "audit_failed",
      "Couldn't record impersonation. Aborted.",
      502,
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
