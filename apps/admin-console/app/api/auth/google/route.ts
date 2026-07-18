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
 * ADR-0008: staff "Continue with Google" — routes to the hosted AuthKit page (default `authkit`
 * provider), where WorkOS's MANAGED Google works. The direct `GoogleOAuth` provider needs a custom
 * Google OAuth credential (none configured — see WorkOS env), so it can't complete. Staff aren't
 * org-scoped, so the hosted page shows no organization picker. Returns through the existing
 * /auth/callback, where resolveSession enforces the staff allowlist.
 */
export function GET(request: NextRequest) {
  if (!workosAuthConfigured()) {
    return NextResponse.redirect(redirectUrl("/signin?error=config", request));
  }
  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = buildAuthorizationUrl(staffRealmConfig(), {
    state,
    screenHint: "sign-in",
  });
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    ...sessionCookieOptions(),
    maxAge: 10 * 60,
  });
  response.cookies.delete(AUTH_NOTICE_COOKIE);
  return response;
}
