import { configurePluginRequestSchema, unwrapEnvelope } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";

/**
 * Install or rotate a provider credential (ADR-0011 §1) → the api's
 * `POST /internal/plugins/:id/credentials`.
 *
 * WRITE-ONLY. There is deliberately no GET: the plaintext is never readable once sealed, and the
 * only thing any read returns is a fingerprint. The secret passes through this handler in flight and
 * is never logged here or downstream — the api audits fingerprint + version only.
 */
function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can install provider credentials.",
      403,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = configurePluginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "The credential payload is invalid.",
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
  const { id } = await params;
  try {
    const res = await fetch(
      new URL(`/internal/plugins/${id}/credentials`, baseUrl),
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-bff-token": token,
          // The actor comes from the SESSION, never the client body.
          "x-actor-email": session.email ?? "unknown",
          "x-actor-staff-id": session.userId,
        },
        body: JSON.stringify(parsed.data),
      },
    );
    // Unwrap before proxying: the browser destructures these fields directly, and forwarding the
    // envelope makes every one of them undefined. The credentials dialog then reports
    // "Version undefined · fingerprint undefined" after a LIVE credential install succeeded — the
    // only readout proving which version is armed, silently wrong.
    const payload = unwrapEnvelope(await res.json()) as Record<string, unknown>;
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
