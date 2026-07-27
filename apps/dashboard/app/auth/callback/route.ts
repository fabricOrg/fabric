import { buildLogout, handleUserCallback } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
  adminConsoleUrl,
  customerRealmConfig,
  noticeCookieOptions,
  OAUTH_STATE_COOKIE,
  redirectUrl,
  sessionCookieOptions,
  WORKOS_COOKIE,
} from "@/lib/server/auth";
import {
  sealWorkspaceSelector,
  WORKSPACE_COOKIE,
  workspaceCookieOptions,
} from "@/lib/server/workspace-cookie";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState) return loginError(request);

  try {
    // ADR-0007: user-level callback — WorkOS proved WHO; where they land depends on memberships:
    // none → onboarding (create a workspace), one → straight in (selector set), several → picker.
    const { session, sealedCookie } = await handleUserCallback(
      customerRealmConfig(),
      { code, state, expectedState },
    );

    // A Fabric OPERATOR with no customer workspace: they got here because staff invitations are
    // sent through the same WorkOS app as customer ones and carry no per-invite redirect. Sending
    // them to /onboarding is how staff ended up creating stray customer tenants they never wanted,
    // in a product they can't administer. Forward them to the console instead — the WorkOS session
    // is deliberately left alive (not logged out) so the console's own OAuth hop completes
    // silently. Staff who ALSO hold a membership fall through and use the dashboard normally.
    if (session?.staffRealm && session.memberships.length === 0) {
      const consoleUrl = adminConsoleUrl("/signin");
      const response = NextResponse.redirect(
        consoleUrl ?? redirectUrl("/signin?error=staff_account", request),
      );
      response.cookies.delete(OAUTH_STATE_COOKIE);
      // Drop any dashboard session left from a PREVIOUS identity. We mint none for this one, and a
      // surviving cookie would both defeat the /signin fallback (that page sends an already-
      // signed-in visitor straight to "/") and leave the operator inside someone else's workspace
      // after what was, to them, a fresh sign-in. Clearing OUR sealed cookie does not end the
      // session at WorkOS — that lives on their domain and only buildLogout ends it — so the
      // console's OAuth hop still completes silently, which is why we don't call it here.
      response.cookies.delete(WORKOS_COOKIE);
      response.cookies.delete(WORKSPACE_COOKIE);
      return response;
    }

    if (session && sealedCookie) {
      const single =
        session.memberships.length === 1 ? session.memberships[0] : undefined;
      const destination =
        session.memberships.length === 0
          ? "/onboarding"
          : single
            ? "/"
            : "/workspaces";
      const response = NextResponse.redirect(redirectUrl(destination, request));
      response.cookies.set(WORKOS_COOKIE, sealedCookie, sessionCookieOptions());
      if (single) {
        response.cookies.set(
          WORKSPACE_COOKIE,
          sealWorkspaceSelector(single.tenantId),
          workspaceCookieOptions(),
        );
      }
      response.cookies.delete(OAUTH_STATE_COOKIE);
      response.cookies.delete(AUTH_NOTICE_COOKIE);
      return response;
    }

    // Authenticated with WorkOS but NOT authorized here (e.g. unverified stranger). END the WorkOS
    // session so the next attempt re-prompts for a different account instead of silently replaying
    // this identity — and drop a flash notice so /login explains the denial.
    if (sealedCookie) {
      const { workosLogoutUrl } = await buildLogout(
        customerRealmConfig(),
        sealedCookie,
      );
      const response = NextResponse.redirect(workosLogoutUrl, 303);
      response.cookies.delete(OAUTH_STATE_COOKIE);
      response.cookies.delete(WORKOS_COOKIE);
      response.cookies.set(
        AUTH_NOTICE_COOKIE,
        "access_denied",
        noticeCookieOptions(),
      );
      return response;
    }

    return loginError(request);
  } catch (error) {
    console.error(
      "WorkOS callback failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return loginError(request);
  }
}

function loginError(request: NextRequest) {
  const response = NextResponse.redirect(
    redirectUrl("/signin?error=authentication", request),
  );
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
