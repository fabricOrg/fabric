import { randomBytes } from "node:crypto";
import { buildAuthorizationUrl } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
  developerRealmConfig,
  OAUTH_STATE_COOKIE,
  redirectUrl,
  sessionCookieOptions,
} from "@/lib/server/auth";

export function GET(request: NextRequest) {
  const state = randomBytes(32).toString("base64url");
  // Org-scoped like the dashboard — a developer signs into their tenant's WorkOS organization.
  const organizationId = process.env.WORKOS_ORGANIZATION_ID;
  if (!organizationId) {
    return NextResponse.redirect(redirectUrl("/login?error=config", request));
  }
  const authorizationUrl = buildAuthorizationUrl(developerRealmConfig(), {
    state,
    organizationId,
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
