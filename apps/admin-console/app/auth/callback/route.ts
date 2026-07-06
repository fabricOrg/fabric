import { handleCallback } from "@app/fe-auth";
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
    const result = await handleCallback(staffRealmConfig(), {
      code,
      state,
      expectedState,
    });
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(
      WORKOS_COOKIE,
      result.sealedCookie,
      sessionCookieOptions(),
    );
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    // resolveStaffSession returning null (email not allowlisted) surfaces here as this specific
    // message from @app/fe-auth's exchangeAndResolve — distinguish it from a real auth failure.
    const deniedByAllowlist =
      error instanceof Error &&
      error.message === "The WorkOS identity is not authorized.";
    console.error(
      "WorkOS callback failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return loginError(
      request,
      deniedByAllowlist ? "access_denied" : "authentication",
    );
  }
}

function loginError(request: NextRequest, reason = "authentication") {
  const response = NextResponse.redirect(
    new URL(`/login?error=${reason}`, request.url),
  );
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
