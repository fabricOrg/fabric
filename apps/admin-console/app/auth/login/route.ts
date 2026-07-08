import { randomBytes } from "node:crypto";
import { buildAuthorizationUrl } from "@app/fe-auth";
import { NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
  OAUTH_STATE_COOKIE,
  sessionCookieOptions,
  staffRealmConfig,
} from "@/lib/server/auth";

export function GET() {
  const state = randomBytes(32).toString("base64url");
  // No organizationId here — staff aren't scoped to one tenant org.
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
