import { buildLogout, handleCallback } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  sessionCookieOptions,
  staffRealmConfig,
  WORKOS_COOKIE,
} from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState) return loginError(request);

  try {
    const { session, sealedCookie } = await handleCallback(staffRealmConfig(), {
      code,
      state,
      expectedState,
    });

    if (session && sealedCookie) {
      const response = NextResponse.redirect(new URL("/", request.url));
      response.cookies.set(WORKOS_COOKIE, sealedCookie, sessionCookieOptions());
      response.cookies.delete(OAUTH_STATE_COOKIE);
      return response;
    }

    // Authenticated with WorkOS but not on the staff allowlist. END the WorkOS session so a retry
    // re-prompts for a different account rather than silently replaying this identity.
    if (sealedCookie) {
      const { workosLogoutUrl } = await buildLogout(
        staffRealmConfig(),
        sealedCookie,
      );
      const response = NextResponse.redirect(workosLogoutUrl, 303);
      response.cookies.delete(OAUTH_STATE_COOKIE);
      response.cookies.delete(WORKOS_COOKIE);
      return response;
    }

    return loginError(request);
  } catch (error) {
    console.error(
      "WorkOS callback failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return loginError(request);
  }
}

function loginError(request: NextRequest, reason = "authentication") {
  const response = NextResponse.redirect(
    new URL(`/login?error=${reason}`, request.url),
  );
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
