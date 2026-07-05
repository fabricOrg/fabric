import { type NextRequest, NextResponse } from "next/server";

/**
 * Mock platform plugin registry (control-plane). TODO(BFF): back with the real registry in
 * services/api (plugin_instances + routing rules + health). Flipping an instance to LIVE (real
 * spend/sends) is a redline — sandbox only until a human activates live with real creds.
 */
const INSTANCES = [
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

export async function GET() {
  return NextResponse.json({ instances: INSTANCES });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
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
  const found = INSTANCES.find((i) => i.id === body.id);
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
