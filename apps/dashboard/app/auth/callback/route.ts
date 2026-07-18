import { buildLogout, handleUserCallback } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
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
    redirectUrl("/login?error=authentication", request),
  );
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
