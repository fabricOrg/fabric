import { NextResponse } from "next/server";
import {
  IMPERSONATION_COOKIE,
  readAdminSessionWithRefresh,
  readImpersonationClaim,
} from "@/lib/server/auth";
import { bffUnauthorized } from "@/lib/server/bff-error";
import { recordImpersonationStop } from "@/lib/server/impersonation-client";
import { requireTrustedOrigin } from "@/lib/server/origin";

/** Stop impersonating: clear the claim cookie + audit. Any staff session may end their own window. */
export async function POST(request: Request) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session) {
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
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
