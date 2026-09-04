import {
  createLiveInstanceRequestSchema,
  unwrapEnvelope,
} from "@app/contracts";
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
 * Create the LIVE sibling of a catalog vendor (ADR-0011 §2) → `POST /internal/plugins/live-instances`.
 *
 * Creating the row is not activating it: it arrives disabled with no credentials, and carrier
 * delivery still needs credentials installed plus an explicit activate-live.
 */

export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can add a live provider instance.",
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = createLiveInstanceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "The request is invalid.",
    );
  }

  const baseUrl = process.env.API_BASE_URL;
  const token = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !token) {
    return bffFailure("registry_unavailable", "Registry is unavailable.", 502);
  }
  try {
    const res = await apiFetch(
      new URL("/internal/plugins/live-instances", baseUrl),
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-bff-token": token },
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
