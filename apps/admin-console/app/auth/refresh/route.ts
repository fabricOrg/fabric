import { refreshSession } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  redirectUrl,
  sessionCookieOptions,
  staffRealmConfig,
  WORKOS_COOKIE,
} from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  const sealedCookie = request.cookies.get(WORKOS_COOKIE)?.value;
  const refreshed = sealedCookie
    ? await refreshSession(staffRealmConfig(), sealedCookie)
    : null;
  if (!refreshed) {
    const response = NextResponse.redirect(redirectUrl("/login", request));
    response.cookies.delete(WORKOS_COOKIE);
    return response;
  }
  const response = NextResponse.redirect(redirectUrl("/", request));
  response.cookies.set(
    WORKOS_COOKIE,
    refreshed.sealedCookie,
    sessionCookieOptions(),
  );
  return response;
}
