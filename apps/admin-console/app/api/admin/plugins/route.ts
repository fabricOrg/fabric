import { type NextRequest, NextResponse } from "next/server";
import { readAdminSession } from "@/lib/server/auth";

/**
 * Plugin registry BFF. When the api is configured (API_BASE_URL + BFF_INTERNAL_TOKEN) this calls the
 * real staff endpoint /internal/plugins (backed by plugin_instances); otherwise an offline mock.
 * Flipping an instance to LIVE (real spend/sends) is a redline — sandbox only until human-activated.
 * Staff-session gated: these routes are directly reachable at the admin origin, so the page guard
 * (requireAdminSession) is NOT enough — every handler must verify the session itself.
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
const MOCK = [
  {
    id: "sms_fake",
    capability: "sms",
    vendor: "FakeProvider",
    label: "FakeProvider",
    enabled: true,
    isDefault: true,
    status: "connected",
    mode: "sandbox",
    region: "gh-accra",
  },
  {
    id: "sms_at",
    capability: "sms",
    vendor: "Africa's Talking",
    label: "Africa's Talking",
    enabled: false,
    isDefault: false,
    status: "available",
    mode: null,
    region: "gh-accra",
  },
  {
    id: "sms_hubtel",
    capability: "sms",
    vendor: "Hubtel",
    label: "Hubtel",
    enabled: false,
    isDefault: false,
    status: "available",
    mode: null,
    region: "gh-accra",
  },
  {
    id: "wa_meta",
    capability: "whatsapp",
    vendor: "Meta WhatsApp Cloud",
    label: "WhatsApp Business Cloud",
    enabled: false,
    isDefault: false,
    status: "available",
    mode: null,
    region: null,
  },
  {
    id: "pay_paystack",
    capability: "payment",
    vendor: "Paystack",
    label: "Paystack",
    enabled: false,
    isDefault: false,
    status: "available",
    mode: null,
    region: "gh-accra",
  },
  {
    id: "pay_flutterwave",
    capability: "payment",
    vendor: "Flutterwave",
    label: "Flutterwave",
    enabled: false,
    isDefault: false,
    status: "available",
    mode: null,
    region: "ng-lagos",
  },
  {
    id: "id_workos",
    capability: "identity",
    vendor: "WorkOS",
    label: "WorkOS AuthKit",
    enabled: true,
    isDefault: true,
    status: "connected",
    mode: "sandbox",
    region: null,
  },
] as const;

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

function apiConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.API_BASE_URL;
  const token = process.env.BFF_INTERNAL_TOKEN;
  return baseUrl && token ? { baseUrl, token } : null;
}

export async function GET() {
  if (!(await readAdminSession())) return unauthorized();
  const cfg = apiConfig();
  if (cfg) {
    try {
      const res = await fetch(new URL("/internal/plugins", cfg.baseUrl), {
        cache: "no-store",
        headers: { "x-bff-token": cfg.token },
      });
      const payload = (await res.json()) as {
        instances?: Record<string, unknown>[];
      };
      if (!res.ok) return NextResponse.json(payload, { status: res.status });
      return NextResponse.json({
        instances: (payload.instances ?? []).map(withRegion),
      });
    } catch {
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
  }
  return NextResponse.json({ instances: MOCK });
}

export async function POST(request: NextRequest) {
  if (!(await readAdminSession())) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badBody();
  }

  const cfg = apiConfig();
  if (cfg) {
    try {
      const res = await fetch(new URL("/internal/plugins", cfg.baseUrl), {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-bff-token": cfg.token,
        },
        body: JSON.stringify({ id: body.id, action: body.action }),
      });
      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok) return NextResponse.json(payload, { status: res.status });
      return NextResponse.json(withRegion(payload));
    } catch {
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
  }

  // Offline mock.
  const found = MOCK.find((i) => i.id === body.id);
  if (!found) {
    return NextResponse.json(
      {
        error: {
          type: "not_found",
          code: "unknown_plugin",
          message: "Unknown plugin instance.",
        },
      },
      { status: 404 },
    );
  }
  const action = body.action;
  return NextResponse.json({
    ...found,
    enabled: action !== "disable",
    isDefault: action === "make-default" ? true : found.isDefault,
    mode: found.mode ?? "sandbox",
    status: action === "disable" ? "available" : "connected",
  });
}
