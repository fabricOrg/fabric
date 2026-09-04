import { unwrapEnvelope } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { apiFetch } from "@/lib/server/api-fetch";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffInvalidRequest,
  bffUnauthorized,
} from "@/lib/server/bff-error";
import { requireTrustedOrigin } from "@/lib/server/origin";

/**
 * Plugin registry BFF → the real staff endpoint /internal/plugins (backed by plugin_instances). No
 * mock: the control plane is live. Flipping an instance to LIVE (real spend/sends) is a redline —
 * sandbox only until human-activated. Staff-session gated: these routes are directly reachable at
 * the admin origin, so the page guard is NOT enough; every handler verifies the session itself.
 */
function unauthorized() {
  return bffUnauthorized("invalid_session", "Staff sign-in required.");
}

function unavailable() {
  return bffFailure(
    "registry_unavailable",
    "Plugin registry is unavailable.",
    502,
  );
}

function badBody() {
  return bffInvalidRequest("invalid_request", "Malformed body.");
}

// The api registry DTO has no market region; the UI treats it as optional.
function withRegion(dto: Record<string, unknown>) {
  return { region: null, ...dto };
}

function apiConfig(): { baseUrl: string; token: string } {
  const baseUrl = process.env.API_BASE_URL;
  const token = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, token };
}

export async function GET() {
  if (!(await readAdminSessionWithRefresh())) return unauthorized();
  try {
    const { baseUrl, token } = apiConfig();
    const res = await apiFetch(new URL("/internal/plugins", baseUrl), {
      cache: "no-store",
      headers: { "x-bff-token": token },
    });
    const payload = unwrapEnvelope(await res.json()) as {
      instances?: Record<string, unknown>[];
    };
    if (!res.ok) return NextResponse.json(payload, { status: res.status });
    return NextResponse.json({
      instances: (payload.instances ?? []).map(withRegion),
    });
  } catch {
    return unavailable();
  }
}

export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  if (!(await readAdminSessionWithRefresh())) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badBody();
  }
  try {
    const { baseUrl, token } = apiConfig();
    const res = await apiFetch(new URL("/internal/plugins", baseUrl), {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-bff-token": token },
      body: JSON.stringify({ id: body.id, action: body.action }),
    });
    const payload = unwrapEnvelope(await res.json()) as Record<string, unknown>;
    if (!res.ok) return NextResponse.json(payload, { status: res.status });
    return NextResponse.json(withRegion(payload));
  } catch {
    return unavailable();
  }
}
