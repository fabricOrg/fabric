import { buildLogout } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_NOTICE_COOKIE,
  noticeCookieOptions,
  redirectUrl,
  staffRealmConfig,
  WORKOS_COOKIE,
  workosAuthConfigured,
} from "@/lib/server/auth";
import { bffForbidden } from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Untrusted request origin.");
  }
  const sealedCookie = request.cookies.get(WORKOS_COOKIE)?.value;
  const logout =
    workosAuthConfigured() && sealedCookie
      ? await buildLogout(staffRealmConfig(), sealedCookie)
      : { workosLogoutUrl: redirectUrl("/login", request).toString() };
  const response = NextResponse.redirect(logout.workosLogoutUrl, 303);
  response.cookies.delete(WORKOS_COOKIE);
  response.cookies.set(AUTH_NOTICE_COOKIE, "signed_out", noticeCookieOptions());
  return response;
}
