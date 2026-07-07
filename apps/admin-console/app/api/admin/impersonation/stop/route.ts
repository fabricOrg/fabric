import { NextResponse } from "next/server";
import {
  IMPERSONATION_COOKIE,
  readAdminSession,
  readImpersonationClaim,
} from "@/lib/server/auth";
import { recordImpersonationStop } from "@/lib/server/impersonation-client";

/** Stop impersonating: clear the claim cookie + audit. Any staff session may end their own window. */
export async function POST() {
  const session = await readAdminSession();
  if (!session) {
    return NextResponse.json(
      {
        error: {
          type: "auth_error",
          code: "invalid_session",
          message: "Staff sign-in required.",
        },
      },
      { status: 401 },
    );
  }

  const claim = await readImpersonationClaim();
  if (claim) {
    // Best-effort audit; clearing the cookie must happen regardless.
    try {
      await recordImpersonationStop(
        {
          tenant_id: claim.targetTenantId,
          tenant_label: claim.targetLabel ?? claim.targetTenantId,
        },
        { email: session.email ?? "unknown", staffId: session.userId },
      );
    } catch {
      // swallow — ending impersonation should never be blocked by an audit hiccup
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(IMPERSONATION_COOKIE);
  return response;
}
