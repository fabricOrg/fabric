// Consent & DND BFF — REAL (E10-S5): opt-outs list/add/remove hit /v1/opt-outs; the send path
// enforces them (recipient_opted_out / promo_quiet_hours). The classification RULES and the
// promotional window are platform policy coded in the api (ConsentService.promoWindowOpen) —
// displayed here, not editable, so "save-quiet-hours" honestly reports not_configurable.

import type { ListOptOutsResponse, OptOutDto } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** The coded promotional window, displayed: quiet 20:00–08:00 local (GH UTC+0 / NG UTC+1). */
const QUIET_HOURS = {
  start: "20:00",
  end: "08:00",
  timezone: "Local (GH UTC+0 · NG UTC+1)",
  enabled: true,
} as const;

// These describe the ENFORCED behavior in the api's send path — platform policy, not tenant config.
const RULES = [
  {
    category: "promotional",
    dndFiltered: true,
    quietHoursEnforced: true,
    description:
      "Marketing and campaign traffic. Blocked for opted-out recipients and only delivered inside the allowed window (08:00–20:00 local).",
  },
  {
    category: "transactional",
    dndFiltered: false,
    quietHoursEnforced: false,
    description:
      "OTP, security codes, alerts, and receipts. Always delivered — bypasses DND and quiet hours, 24/7. 'All'-scope opt-outs still suppress it.",
  },
] as const;

const SOURCE_LABEL: Record<OptOutDto["source"], string> = {
  stop: "STOP-reply",
  registry: "2442-registry",
  manual: "manual",
};

function toUi(dto: OptOutDto) {
  return {
    id: dto.id,
    msisdn: dto.msisdn,
    scope: dto.scope,
    source: SOURCE_LABEL[dto.source],
    at: dto.created_at,
  };
}

export async function GET() {
  try {
    const response = await dashboardApi<ListOptOutsResponse>(
      "/v1/opt-outs",
      "sms:read",
    );
    return NextResponse.json({
      optOuts: response.opt_outs.map(toUi),
      quietHours: QUIET_HOURS,
      rules: RULES,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return forbidden();
  try {
    const input = (await request.json()) as {
      action?: unknown;
      msisdn?: unknown;
      scope?: unknown;
    };

    if (input.action === "save-quiet-hours") {
      return NextResponse.json(
        {
          error: {
            type: "invalid_request_error",
            code: "not_configurable",
            message:
              "The promotional window is platform policy (08:00–20:00 local) and can't be changed per workspace yet.",
          },
        },
        { status: 400 },
      );
    }

    if (input.action === "add-optout") {
      const created = await dashboardApi<OptOutDto>(
        "/v1/opt-outs",
        "sms:send",
        {
          method: "POST",
          body: JSON.stringify({
            msisdn: typeof input.msisdn === "string" ? input.msisdn : "",
            scope: input.scope === "all" ? "all" : "promotional",
          }),
        },
      );
      return NextResponse.json({ optOut: toUi(created) }, { status: 201 });
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
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
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
  try {
    await dashboardApi<{ removed: boolean }>(`/v1/opt-outs/${id}`, "sms:send", {
      method: "DELETE",
    });
    return NextResponse.json({ removed: true, id });
  } catch (error) {
    return errorResponse(error);
  }
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

function errorResponse(error: unknown) {
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : NextResponse.json(
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
