import { refreshSessionDetailed } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  redirectUrl,
  sessionCookieOptions,
  staffRealmConfig,
  WORKOS_COOKIE,
} from "@/lib/server/auth";

/**
 * Access-token refresh hop for page loads (G2 hardening). Terminal failure (spent/revoked
 * refresh token) clears the cookie → genuine re-login. TRANSIENT failure (WorkOS/network blip)
 * keeps the cookie — deleting it would log every signed-in user out during a provider hiccup;
 * the login page's authed-bounce sends them home once the provider recovers.
 */
export async function GET(request: NextRequest) {
  const sealedCookie = request.cookies.get(WORKOS_COOKIE)?.value;
  if (!sealedCookie) {
    return NextResponse.redirect(redirectUrl("/login", request));
  }
  const outcome = await refreshSessionDetailed(
    staffRealmConfig(),
    sealedCookie,
  );
  if (outcome.status === "refreshed") {
    const response = NextResponse.redirect(redirectUrl("/", request));
    response.cookies.set(
      WORKOS_COOKIE,
      outcome.sealedCookie,
      sessionCookieOptions(),
    );
    return response;
  }
  const response = NextResponse.redirect(redirectUrl("/login", request));
  if (outcome.status === "terminal") {
    response.cookies.delete(WORKOS_COOKIE);
  }
  return response;
}
