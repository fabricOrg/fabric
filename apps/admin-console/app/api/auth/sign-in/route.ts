import { signInStaffWithPassword } from "@app/fe-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AUTH_NOTICE_COOKIE,
  sessionCookieOptions,
  staffRealmConfig,
  WORKOS_COOKIE,
  workosAuthConfigured,
} from "@/lib/server/auth";
import { allowCredentialAttempt } from "@/lib/server/auth-rate-limit";
import { isCrossSiteRequest } from "@/lib/server/auth-request";

const signInSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(400),
});

/** ADR-0008: Fabric-owned staff sign-in — the BFF calls WorkOS, the browser never does. */
export async function POST(request: Request) {
  if (isCrossSiteRequest(request)) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  if (!workosAuthConfigured()) {
    return NextResponse.json(
      { outcome: "error", message: "Sign-in is not configured." },
      { status: 503 },
    );
  }
  const parsed = signInSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { outcome: "invalid_request", message: "Enter your email and password." },
      { status: 400 },
    );
  }
  if (!(await allowCredentialAttempt(parsed.data.email))) {
    return NextResponse.json(
      {
        outcome: "rate_limited",
        message: "Too many attempts. Try again later.",
      },
      { status: 429 },
    );
  }
  // Password is used here and dropped — never persisted, logged, or echoed (ADR-0008).
  const outcome = await signInStaffWithPassword(staffRealmConfig(), {
    email: parsed.data.email,
    password: parsed.data.password,
  });

  switch (outcome.status) {
    case "authenticated": {
      const response = NextResponse.json({
        outcome: "authenticated",
        next: "/",
      });
      response.cookies.set(
        WORKOS_COOKIE,
        outcome.sealedCookie,
        sessionCookieOptions(),
      );
      response.cookies.delete(AUTH_NOTICE_COOKIE);
      return response;
    }
    case "fallback_hosted":
      return NextResponse.json({
        outcome: "fallback_hosted",
        href: "/auth/login",
      });
    case "invalid_credentials":
      return NextResponse.json(
        { outcome: "invalid_credentials" },
        { status: 401 },
      );
    default:
      return NextResponse.json(
        { outcome: "error", message: outcome.message },
        { status: 502 },
      );
  }
}
