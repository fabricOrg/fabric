import "server-only";

import type { CredentialOutcome, UserSession } from "@app/fe-auth";
import { NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
  adminConsoleUrl,
  sessionCookieOptions,
  WORKOS_COOKIE,
} from "./auth";
import {
  sealWorkspaceSelector,
  WORKSPACE_COOKIE,
  workspaceCookieOptions,
} from "./workspace-cookie";

/**
 * ADR-0008: turn a fe-auth CredentialOutcome into the BFF's JSON response for the auth screens.
 * The `authenticated` branch sets the SAME sealed cookie + workspace selector the OAuth callback
 * does and routes by membership count (none → onboarding, one → in, several → picker), so the
 * custom screens land users exactly where the hosted flow did. The client reads `outcome` and
 * navigates.
 */
export function credentialResponse(outcome: CredentialOutcome): NextResponse {
  switch (outcome.status) {
    case "authenticated":
      return authenticatedResponse(outcome.session, outcome.sealedCookie);
    case "verification_required":
      return NextResponse.json({
        outcome: "verification_required",
        pending_authentication_token: outcome.pendingAuthenticationToken,
        email: outcome.email,
      });
    case "fallback_hosted":
      // The custom screen can't finish this challenge (MFA/SSO/passkey/Radar) — hand off to the
      // hosted AuthKit page, which handles all of them.
      return NextResponse.json({
        outcome: "fallback_hosted",
        href: "/auth/login",
      });
    case "invalid_credentials":
      return NextResponse.json(
        { outcome: "invalid_credentials" },
        { status: 401 },
      );
    default:
      return NextResponse.json(
        { outcome: "error", message: outcome.message },
        { status: 502 },
      );
  }
}

export function authenticatedResponse(
  session: UserSession,
  sealedCookie: string,
): NextResponse {
  // Fabric OPERATOR with no customer workspace — the same case the OAuth callback handles. Send
  // them to the console and set NO dashboard cookie: a session that can only reach /onboarding is
  // how staff end up creating stray customer tenants. Staff who also hold a membership fall
  // through and use the dashboard normally.
  if (session.staffRealm && session.memberships.length === 0) {
    const response = NextResponse.json({
      outcome: "authenticated",
      next: adminConsoleUrl("/signin") ?? "/signin?error=staff_account",
    });
    // Same reasoning as the OAuth callback: mint nothing for this identity, and clear a session
    // left by a previous one so the /signin fallback isn't skipped and the operator doesn't land
    // in someone else's workspace.
    response.cookies.delete(WORKOS_COOKIE);
    response.cookies.delete(WORKSPACE_COOKIE);
    return response;
  }

  const single =
    session.memberships.length === 1 ? session.memberships[0] : undefined;
  const next =
    session.memberships.length === 0
      ? "/onboarding"
      : single
        ? "/"
        : "/workspaces";
  const response = NextResponse.json({ outcome: "authenticated", next });
  response.cookies.set(WORKOS_COOKIE, sealedCookie, sessionCookieOptions());
  if (single) {
    response.cookies.set(
      WORKSPACE_COOKIE,
      sealWorkspaceSelector(single.tenantId),
      workspaceCookieOptions(),
    );
  }
  response.cookies.delete(AUTH_NOTICE_COOKIE);
  return response;
}
