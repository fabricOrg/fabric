import { randomBytes } from "node:crypto";
import { buildAuthorizationUrl } from "@app/fe-auth";
import { NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
  developerRealmConfig,
  OAUTH_STATE_COOKIE,
  sessionCookieOptions,
} from "@/lib/server/auth";

export function GET() {
  const state = randomBytes(32).toString("base64url");
  // ADR-0002: unpinned like the dashboard — the developer's org resolves from their membership
  // on the callback. Sign-in only: workspaces are created on the dashboard, never here.
  const authorizationUrl = buildAuthorizationUrl(developerRealmConfig(), {
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
