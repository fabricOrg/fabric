import { handleCallback } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  customerRealmConfig,
  OAUTH_STATE_COOKIE,
  redirectUrl,
  sessionCookieOptions,
  WORKOS_COOKIE,
} from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState) return loginError(request);

  try {
    const result = await handleCallback(customerRealmConfig(), {
      code,
      state,
      expectedState,
    });
    const response = NextResponse.redirect(redirectUrl("/", request));
    response.cookies.set(
      WORKOS_COOKIE,
      result.sealedCookie,
      sessionCookieOptions(),
    );
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    console.error(
      "WorkOS callback failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return loginError(request);
  }
}

function loginError(request: NextRequest) {
  const response = NextResponse.redirect(
    redirectUrl("/login?error=authentication", request),
  );
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
