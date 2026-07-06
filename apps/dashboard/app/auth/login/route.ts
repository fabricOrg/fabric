import { randomBytes } from "node:crypto";
import { buildAuthorizationUrl } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  customerRealmConfig,
  OAUTH_STATE_COOKIE,
  redirectUrl,
  sessionCookieOptions,
} from "@/lib/server/auth";

export function GET(request: NextRequest) {
  const state = randomBytes(32).toString("base64url");
  const organizationId = process.env.WORKOS_ORGANIZATION_ID;
  if (!organizationId) {
    return NextResponse.redirect(redirectUrl("/login?error=config", request));
  }
  const authorizationUrl = buildAuthorizationUrl(customerRealmConfig(), {
    state,
    organizationId,
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
  return response;
}
