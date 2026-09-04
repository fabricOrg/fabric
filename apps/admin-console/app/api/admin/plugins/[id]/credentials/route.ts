import { configurePluginRequestSchema, unwrapEnvelope } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import {
  API_EXTERNAL_WRITE_TIMEOUT_MS,
  apiFetch,
} from "@/lib/server/api-fetch";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { requireTrustedOrigin } from "@/lib/server/origin";

/**
 * Install or rotate a provider credential (ADR-0011 §1) → the api's
 * `POST /internal/plugins/:id/credentials`.
 *
 * WRITE-ONLY. There is deliberately no GET: the plaintext is never readable once sealed, and the
 * only thing any read returns is a fingerprint. The secret passes through this handler in flight and
 * is never logged here or downstream — the api audits fingerprint + version only.
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can install provider credentials.",
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = configurePluginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "The credential payload is invalid.",
    );
  }

  const baseUrl = process.env.API_BASE_URL;
  const token = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !token) {
    return bffFailure("registry_unavailable", "Registry is unavailable.", 502);
  }
  const { id } = await params;
  try {
    // Installing a credential verifies it against the provider before it is sealed, so this is an
    // external write: a short deadline reports a failure for a credential that is now armed.
    const res = await apiFetch(
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
      API_EXTERNAL_WRITE_TIMEOUT_MS,
    );
    // Unwrap before proxying: the browser destructures these fields directly, and forwarding the
    // envelope makes every one of them undefined. The credentials dialog then reports
    // "Version undefined · fingerprint undefined" after a LIVE credential install succeeded — the
    // only readout proving which version is armed, silently wrong.
    const payload = unwrapEnvelope(await res.json()) as Record<string, unknown>;
    return NextResponse.json(payload, { status: res.status });
  } catch {
    return bffFailure(
      "registry_unavailable",
      "Plugin registry is unavailable.",
      502,
    );
  }
}
