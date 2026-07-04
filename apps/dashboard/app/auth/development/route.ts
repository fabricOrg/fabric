import { NextResponse } from "next/server";
import { verifyConfiguredTenant } from "@/lib/server/api-client";
import {
  configuredDevelopmentSession,
  DEVELOPMENT_COOKIE,
  developmentAuthConfig,
  issueDevelopmentSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";

export async function POST(request: Request) {
  const config = developmentAuthConfig();
  if (!config.enabled || config.runtime === "production") {
    return new NextResponse(null, { status: 404 });
  }
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "Untrusted request origin." },
      { status: 403 },
    );
  }
  const session = configuredDevelopmentSession();
  await verifyConfiguredTenant(session.orgId);
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(DEVELOPMENT_COOKIE, issueDevelopmentSession(), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return response;
}
