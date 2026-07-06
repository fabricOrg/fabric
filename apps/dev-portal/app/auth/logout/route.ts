import { buildLogout } from "@app/fe-auth";
import { type NextRequest, NextResponse } from "next/server";
import {
  DEVELOPMENT_COOKIE,
  developerRealmConfig,
  WORKOS_COOKIE,
  workosAuthConfigured,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "Untrusted request origin." },
      { status: 403 },
    );
  }
  const sealedCookie = request.cookies.get(WORKOS_COOKIE)?.value;
  const logout =
    workosAuthConfigured() && sealedCookie
      ? await buildLogout(developerRealmConfig(), sealedCookie)
      : { workosLogoutUrl: new URL("/login", request.url).toString() };
  const response = NextResponse.redirect(logout.workosLogoutUrl, 303);
  response.cookies.delete(WORKOS_COOKIE);
  response.cookies.delete(DEVELOPMENT_COOKIE);
  return response;
}
