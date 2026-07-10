// Verify (OTP) BFF — fully REAL (V1 actions + V2 overview): GET returns the tenant's actual
// recent verifications, funnel and 14-day trend from /v1/verify/overview; the channel matrix is
// the HONEST platform state (SMS live; voice/whatsapp/email arrive as Verify fallbacks later,
// so they render disabled). POST drives /v1/verify + /v1/verify/check.

import type {
  VerifyCheckResponse,
  VerifyOverviewResponse,
  VerifyStartResponse,
} from "@app/contracts";
import { NextResponse } from "next/server";
import {
  checkVerificationRequest,
  saveChannelsRequest,
  startVerificationRequest,
  type Verification,
} from "@/lib/client/verify-api";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Honest channel state: only SMS is live. Order = future failover rank. */
const CHANNELS = [
  { channel: "sms" as const, enabled: true, order: 1 },
  { channel: "voice" as const, enabled: false, order: 2 },
  { channel: "whatsapp" as const, enabled: false, order: 3 },
  { channel: "email" as const, enabled: false, order: 4 },
];

export async function GET() {
  try {
    const overview = await dashboardApi<VerifyOverviewResponse>(
      "/v1/verify/overview",
      "sms:read",
    );
    return NextResponse.json({
      channels: CHANNELS,
      recent: overview.recent.map((v) => ({
        id: v.id,
        msisdn: v.msisdn,
        channel: v.channel,
        status: v.status,
        createdAt: v.created_at,
        verifiedAt: v.verified_at,
      })),
      stats: overview.stats,
      trend: overview.trend,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
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
  try {
    const raw = (await request.json()) as { action?: unknown };

    if (raw.action === "start") {
      const { msisdn, channel } = startVerificationRequest.parse(raw);
      // V1 is SMS-only. No mock success for other channels — an honest structured error.
      if (channel !== "sms") {
        return NextResponse.json(
          {
            error: {
              type: "invalid_request_error",
              code: "channel_not_available",
              message:
                "Only the SMS channel is live. Voice/WhatsApp/Email arrive as Verify fallbacks later.",
            },
          },
          { status: 400 },
        );
      }
      const started = await dashboardApi<VerifyStartResponse>(
        "/v1/verify",
        "sms:send",
        { method: "POST", body: JSON.stringify({ to: msisdn }) },
      );
      const verification: Verification = {
        id: started.id,
        msisdn: started.to, // masked by the API — the raw number is never echoed
        channel: "sms",
        status: started.status,
        createdAt: new Date().toISOString(),
        verifiedAt: null,
      };
      // debug_code: sandbox tenants only (the API withholds it on live plans) — lets the test
      // flow complete without a real phone.
      return NextResponse.json({
        verification,
        ...(started.debug_code ? { debugCode: started.debug_code } : {}),
      });
    }

    if (raw.action === "check") {
      const { id, code } = checkVerificationRequest.parse(raw);
      const checked = await dashboardApi<VerifyCheckResponse>(
        "/v1/verify/check",
        "sms:send",
        { method: "POST", body: JSON.stringify({ id, code }) },
      );
      const verification: Verification = {
        id: checked.id,
        msisdn: "",
        channel: "sms",
        status: checked.status,
        createdAt: new Date().toISOString(),
        verifiedAt: checked.verified_at,
      };
      return NextResponse.json({ verification });
    }

    if (raw.action === "save-channels") {
      const { channels } = saveChannelsRequest.parse(raw);
      return NextResponse.json({ channels });
    }

    return NextResponse.json(
      {
        error: {
          type: "invalid_request_error",
          code: "unknown_action",
          message: "Unknown Verify action.",
        },
      },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
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
