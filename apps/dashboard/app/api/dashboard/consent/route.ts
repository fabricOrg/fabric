// TODO(BFF): replace mock with dashboardApi("/v1/consent", ...) — GET snapshot, POST manual opt-out /
// quiet-hours save, DELETE opt-out. Mock-first: this returns/echoes JSON with no persistence so the
// Consent & DND screen can be built and reviewed before the service exists.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { hasTrustedOrigin } from "@/lib/server/origin";

const MOCK_QUIET_HOURS = {
  start: "20:00",
  end: "08:00",
  timezone: "Africa/Lagos",
  enabled: true,
} as const;

// Transactional (OTP/alerts) always delivers; promotional is DND-filtered AND time-boxed.
const MOCK_RULES = [
  {
    category: "promotional",
    dndFiltered: true,
    quietHoursEnforced: true,
    description:
      "Marketing and campaign traffic. Filtered against the 2442 DND opt-out registry and only delivered inside the allowed window (08:00–20:00 WAT).",
  },
  {
    category: "transactional",
    dndFiltered: false,
    quietHoursEnforced: false,
    description:
      "OTP, security codes, alerts, and receipts. Always delivered — bypasses DND and quiet hours, 24/7.",
  },
] as const;

const MOCK_OPT_OUTS = [
  {
    id: "oo_01",
    msisdn: "+2348031234567",
    scope: "all",
    source: "2442-registry",
    at: "2026-06-28T09:12:00.000Z",
  },
  {
    id: "oo_02",
    msisdn: "+2348062345678",
    scope: "promotional",
    source: "STOP-reply",
    at: "2026-06-30T14:45:00.000Z",
  },
  {
    id: "oo_03",
    msisdn: "+2347039876543",
    scope: "all",
    source: "manual",
    at: "2026-07-01T08:03:00.000Z",
  },
  {
    id: "oo_04",
    msisdn: "+2348157654321",
    scope: "promotional",
    source: "2442-registry",
    at: "2026-07-01T18:20:00.000Z",
  },
  {
    id: "oo_05",
    msisdn: "+2349011223344",
    scope: "all",
    source: "STOP-reply",
    at: "2026-07-02T11:37:00.000Z",
  },
  {
    id: "oo_06",
    msisdn: "+2348188776655",
    scope: "promotional",
    source: "manual",
    at: "2026-07-02T16:59:00.000Z",
  },
  {
    id: "oo_07",
    msisdn: "+2347065554433",
    scope: "all",
    source: "2442-registry",
    at: "2026-07-03T07:15:00.000Z",
  },
  {
    id: "oo_08",
    msisdn: "+2348024445566",
    scope: "promotional",
    source: "STOP-reply",
    at: "2026-07-03T13:02:00.000Z",
  },
  {
    id: "oo_09",
    msisdn: "+2349087771122",
    scope: "all",
    source: "2442-registry",
    at: "2026-07-03T19:48:00.000Z",
  },
  {
    id: "oo_10",
    msisdn: "+2348133339900",
    scope: "promotional",
    source: "manual",
    at: "2026-07-04T06:31:00.000Z",
  },
] as const;

export function GET() {
  return NextResponse.json({
    optOuts: MOCK_OPT_OUTS,
    quietHours: MOCK_QUIET_HOURS,
    rules: MOCK_RULES,
  });
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return forbidden();
  try {
    const input = (await request.json()) as {
      action?: unknown;
      msisdn?: unknown;
      scope?: unknown;
      quietHours?: unknown;
    };

    if (input.action === "save-quiet-hours") {
      // Echo the saved window back (no persistence in the mock).
      return NextResponse.json({ quietHours: input.quietHours });
    }

    if (input.action === "add-optout") {
      const optOut = {
        id: `oo_${randomUUID().slice(0, 8)}`,
        msisdn: input.msisdn,
        scope: input.scope,
        source: "manual",
        at: new Date().toISOString(),
      };
      return NextResponse.json({ optOut }, { status: 201 });
    }

    return NextResponse.json(
      {
        error: {
          type: "validation_error",
          code: "unknown_action",
          message: "Unsupported consent action.",
        },
      },
      { status: 400 },
    );
  } catch {
    return errorResponse();
  }
}

export function DELETE(request: Request) {
  if (!hasTrustedOrigin(request)) return forbidden();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      {
        error: {
          type: "validation_error",
          code: "missing_id",
          message: "An opt-out id is required.",
        },
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ removed: true, id });
}

function forbidden() {
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

function errorResponse() {
  return NextResponse.json(
    {
      error: {
        type: "api_error",
        code: "bff_error",
        message: "Request failed.",
      },
    },
    { status: 500 },
  );
}
