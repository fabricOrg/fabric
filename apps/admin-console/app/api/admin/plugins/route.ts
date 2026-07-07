import { type NextRequest, NextResponse } from "next/server";
import { readAdminSession } from "@/lib/server/auth";

/**
 * Plugin registry BFF → the real staff endpoint /internal/plugins (backed by plugin_instances). No
 * mock: the control plane is live. Flipping an instance to LIVE (real spend/sends) is a redline —
 * sandbox only until human-activated. Staff-session gated: these routes are directly reachable at
 * the admin origin, so the page guard is NOT enough; every handler verifies the session itself.
 */
function unauthorized() {
  return NextResponse.json(
    {
      error: {
        type: "auth_error",
        code: "invalid_session",
        message: "Staff sign-in required.",
      },
    },
    { status: 401 },
  );
}

function unavailable() {
  return NextResponse.json(
    {
      error: {
        type: "api_error",
        code: "registry_unavailable",
        message: "Plugin registry is unavailable.",
      },
    },
    { status: 502 },
  );
}

function badBody() {
  return NextResponse.json(
    {
      error: {
        type: "validation_error",
        code: "invalid_request",
        message: "Malformed body.",
      },
    },
    { status: 400 },
  );
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
  if (!(await readAdminSession())) return unauthorized();
  try {
    const { baseUrl, token } = apiConfig();
    const res = await fetch(new URL("/internal/plugins", baseUrl), {
      cache: "no-store",
      headers: { "x-bff-token": token },
    });
    const payload = (await res.json()) as {
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
  if (!(await readAdminSession())) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badBody();
  }
  try {
    const { baseUrl, token } = apiConfig();
    const res = await fetch(new URL("/internal/plugins", baseUrl), {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-bff-token": token },
      body: JSON.stringify({ id: body.id, action: body.action }),
    });
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return NextResponse.json(payload, { status: res.status });
    return NextResponse.json(withRegion(payload));
  } catch {
    return unavailable();
  }
}
