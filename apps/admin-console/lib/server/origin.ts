import "server-only";
import { NextResponse } from "next/server";

/**
 * CSRF defense for state-changing BFF routes (IDENTITY-SSO.md §9): the sealed session cookie is
 * sent automatically by the browser and SameSite=Lax alone does not cover every cross-site write
 * path, so every mutation handler verifies the request ORIGIN against this app's public base URL.
 * Same fallback as auth.ts's appBaseUrl so local dev works without the env var; in cloud
 * ADMIN_CONSOLE_BASE_URL is always set.
 */
export function hasTrustedOrigin(request: Request): boolean {
  const expected = (
    process.env.ADMIN_CONSOLE_BASE_URL?.trim() || "http://localhost:3300"
  ).replace(/\/$/, "");
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === expected);
}

/**
 * Gate for mutation handlers — the admin console (kill-switches, staff, impersonation) is the
 * highest-privilege surface and must not be the one app without origin checks. Returns the 403
 * to send when untrusted, or null to proceed:
 * `const denied = requireTrustedOrigin(request); if (denied) return denied;`
 */
export function requireTrustedOrigin(request: Request): NextResponse | null {
  if (hasTrustedOrigin(request)) return null;
  return NextResponse.json(
    {
      error: {
        type: "auth_error",
        code: "invalid_origin",
        message: "Request rejected.",
      },
    },
    { status: 403 },
  );
}
