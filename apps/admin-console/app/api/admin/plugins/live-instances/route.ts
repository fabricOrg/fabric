import { createLiveInstanceRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";

/**
 * Create the LIVE sibling of a catalog vendor (ADR-0011 §2) → `POST /internal/plugins/live-instances`.
 *
 * Creating the row is not activating it: it arrives disabled with no credentials, and carrier
 * delivery still needs credentials installed plus an explicit activate-live.
 */
function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can add a live provider instance.",
      403,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = createLiveInstanceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "The request is invalid.",
      422,
      "validation_error",
    );
  }

  const baseUrl = process.env.API_BASE_URL;
  const token = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !token) {
    return fail(
      "registry_unavailable",
      "Registry is unavailable.",
      502,
      "api_error",
    );
  }
  try {
    const res = await fetch(
      new URL("/internal/plugins/live-instances", baseUrl),
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-bff-token": token },
        body: JSON.stringify(parsed.data),
      },
    );
    const payload = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(payload, { status: res.status });
  } catch {
    return fail(
      "registry_unavailable",
      "Plugin registry is unavailable.",
      502,
      "api_error",
    );
  }
}
