import { randomBytes } from "node:crypto";
import { buildAuthorizationUrl } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
  OAUTH_STATE_COOKIE,
  redirectUrl,
  sessionCookieOptions,
  staffRealmConfig,
  workosAuthConfigured,
} from "@/lib/server/auth";

/**
 * ADR-0008: staff "Continue with Google" — straight to Google's consent screen (provider
 * GoogleOAuth), skipping the hosted AuthKit page and its org-selection screen. Returns through the
 * existing /auth/callback, where resolveSession enforces the staff allowlist.
 */
export function GET(request: NextRequest) {
  if (!workosAuthConfigured()) {
    return NextResponse.redirect(redirectUrl("/signin?error=config", request));
  }
  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = buildAuthorizationUrl(staffRealmConfig(), {
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
