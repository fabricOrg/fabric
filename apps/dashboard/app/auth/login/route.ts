import { randomBytes } from "node:crypto";
import { buildAuthorizationUrl } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
  customerRealmConfig,
  OAUTH_STATE_COOKIE,
  sessionCookieOptions,
} from "@/lib/server/auth";

export function GET(request: NextRequest) {
  const state = randomBytes(32).toString("base64url");
  // ADR-0002: logins are UNPINNED — no organizationId on the authorization URL. A returning
  // user's org (or a verified stranger's fresh sandbox) is resolved on the callback via
  // resolveOrganization, so one login page serves every tenant.
  const authorizationUrl = buildAuthorizationUrl(customerRealmConfig(), {
    state,
    screenHint:
      request.nextUrl.searchParams.get("screen_hint") === "sign-up"
        ? "sign-up"
        : "sign-in",
  });
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    ...sessionCookieOptions(),
    maxAge: 10 * 60,
  });
  response.cookies.delete(AUTH_NOTICE_COOKIE);
  return response;
}
