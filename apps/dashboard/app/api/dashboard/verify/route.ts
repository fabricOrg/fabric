// Verify (OTP) BFF. start/check are REAL (V1: /v1/verify + /v1/verify/check — SMS channel).
// The channel matrix, recent log, funnel stats and trend remain synthesized until the V2 Verify
// dashboard surface lands — GET is display-only and clearly V2 scope; the ACTIONS are live.
// Mirrors the shared errorResponse envelope + trusted-origin guard used by the SMS routes.

import type { VerifyCheckResponse, VerifyStartResponse } from "@app/contracts";
import { NextResponse } from "next/server";
import {
  checkVerificationRequest,
  saveChannelsRequest,
  startVerificationRequest,
  type Verification,
  type VerifyChannelName,
} from "@/lib/client/verify-api";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

const MINUTE = 60_000;

/** Default channel matrix: SMS + Voice live, WhatsApp staged (off), Email off. Order = failover rank. */
const CHANNELS = [
  { channel: "sms" as const, enabled: true, order: 1 },
  { channel: "voice" as const, enabled: true, order: 2 },
  { channel: "whatsapp" as const, enabled: false, order: 3 },
  { channel: "email" as const, enabled: false, order: 4 },
];

/** 9 recent verifications across channels + a realistic status mix (mostly verified, some drop-off). */
function recentVerifications(now: number): Verification[] {
  const rows: Array<{
    msisdn: string;
    channel: VerifyChannelName;
    status: Verification["status"];
    ageMin: number;
    tookSec: number | null;
  }> = [
    {
      msisdn: "+233201234567",
      channel: "sms",
      status: "verified",
      ageMin: 2,
      tookSec: 21,
    },
    {
      msisdn: "+234803******12",
      channel: "sms",
      status: "verified",
      ageMin: 6,
      tookSec: 34,
    },
    {
      msisdn: "+233559876543",
      channel: "voice",
      status: "verified",
      ageMin: 11,
      tookSec: 48,
    },
    {
      msisdn: "+233241112233",
      channel: "sms",
      status: "pending",
      ageMin: 1,
      tookSec: null,
    },
    {
      msisdn: "+2547001234**",
      channel: "whatsapp",
      status: "verified",
      ageMin: 18,
      tookSec: 12,
    },
    {
      msisdn: "+233207654321",
      channel: "sms",
      status: "expired",
      ageMin: 27,
      tookSec: null,
    },
    {
      msisdn: "+233501239876",
      channel: "voice",
      status: "failed",
      ageMin: 33,
      tookSec: null,
    },
    {
      msisdn: "+233244556677",
      channel: "sms",
      status: "verified",
      ageMin: 41,
      tookSec: 29,
    },
    {
      msisdn: "+233559988776",
      channel: "whatsapp",
      status: "verified",
      ageMin: 52,
      tookSec: 17,
    },
  ];
  return rows.map((r, i) => {
    const createdAt = new Date(now - r.ageMin * MINUTE).toISOString();
    const verifiedAt =
      r.status === "verified" && r.tookSec !== null
        ? new Date(now - r.ageMin * MINUTE + r.tookSec * 1000).toISOString()
        : null;
    return {
      id: `ver_${(now - i).toString(36)}`,
      msisdn: r.msisdn,
      channel: r.channel,
      status: r.status,
      createdAt,
      verifiedAt,
    };
  });
}

// Last 14 days: attempts started vs successfully verified (verified ≤ attempts). TODO(BFF): real rollup.
const TREND = [
  { date: "Jun 22", attempts: 92, verified: 74 },
  { date: "Jun 23", attempts: 108, verified: 89 },
  { date: "Jun 24", attempts: 86, verified: 71 },
  { date: "Jun 25", attempts: 124, verified: 103 },
  { date: "Jun 26", attempts: 117, verified: 96 },
  { date: "Jun 27", attempts: 71, verified: 58 },
  { date: "Jun 28", attempts: 64, verified: 51 },
  { date: "Jun 29", attempts: 103, verified: 86 },
  { date: "Jun 30", attempts: 119, verified: 99 },
  { date: "Jul 1", attempts: 138, verified: 117 },
  { date: "Jul 2", attempts: 129, verified: 108 },
  { date: "Jul 3", attempts: 112, verified: 91 },
  { date: "Jul 4", attempts: 141, verified: 120 },
  { date: "Jul 5", attempts: 78, verified: 63 },
];

export function GET() {
  const now = Date.now();
  return NextResponse.json({
    channels: CHANNELS,
    recent: recentVerifications(now),
    // Coherent funnel: verified ≤ delivered ≤ sent.
    stats: { sent: 1284, delivered: 1207, verified: 1043 },
    trend: TREND,
  });
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
