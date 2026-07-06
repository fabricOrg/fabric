import { randomBytes } from "node:crypto";
import { buildAuthorizationUrl } from "@app/fe-auth";
import { NextResponse } from "next/server";
import {
  developerRealmConfig,
  OAUTH_STATE_COOKIE,
  sessionCookieOptions,
} from "@/lib/server/auth";

export function GET() {
  const state = randomBytes(32).toString("base64url");
  // No organizationId here — this is a coarse allowlist gate, not tenant-scoped (yet).
  const authorizationUrl = buildAuthorizationUrl(developerRealmConfig(), {
    state,
    screenHint: "sign-in",
  });
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    ...sessionCookieOptions(),
    maxAge: 10 * 60,
  });
  return response;
}
