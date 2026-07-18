import { randomBytes } from "node:crypto";
import { buildAuthorizationUrl } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
  customerRealmConfig,
  OAUTH_STATE_COOKIE,
  redirectUrl,
  sessionCookieOptions,
  workosAuthConfigured,
} from "@/lib/server/auth";

/**
 * ADR-0008: "Continue with Google" — redirect STRAIGHT to Google's consent screen (provider
 * GoogleOAuth), skipping the hosted AuthKit page entirely. Returns through the existing
 * /auth/callback (handleUserCallback), so the user never sees a WorkOS screen.
 */
export function GET(request: NextRequest) {
  if (!workosAuthConfigured()) {
    return NextResponse.redirect(redirectUrl("/signin?error=config", request));
  }
  const state = randomBytes(32).toString("base64url");
  // NOTE: screenHint is an authkit-only option — WorkOS rejects it for the GoogleOAuth provider.
  const authorizationUrl = buildAuthorizationUrl(customerRealmConfig(), {
    state,
    provider: "GoogleOAuth",
  });
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    ...sessionCookieOptions(),
    maxAge: 10 * 60,
  });
  response.cookies.delete(AUTH_NOTICE_COOKIE);
  return response;
}
