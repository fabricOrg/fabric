// Verify (OTP) BFF stub. Mock-first: no real backend — this route synthesizes coherent JSON so the
// dashboard's Verify screen renders end-to-end. GET returns the channel matrix + recent log + funnel
// stats; POST drives the test-verification flow (start → check) and persists the channel matrix.
// Mirrors the shared errorResponse envelope + trusted-origin guard used by the SMS routes.
// TODO(BFF): replace mock with dashboardApi("/v1/verify", ...) once the OTP epic ships.

import { NextResponse } from "next/server";
import {
  checkVerificationRequest,
  DEMO_OK_CODE,
  saveChannelsRequest,
  startVerificationRequest,
  type Verification,
  type VerifyChannelName,
} from "@/lib/client/verify-api";
import { BffError } from "@/lib/server/api-client";
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

export function GET() {
  const now = Date.now();
  return NextResponse.json({
    channels: CHANNELS,
    recent: recentVerifications(now),
    // Coherent funnel: verified ≤ delivered ≤ sent.
    stats: { sent: 1284, delivered: 1207, verified: 1043 },
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
      const now = Date.now();
      const started: Verification = {
        id: `ver_${now.toString(36)}`,
        msisdn,
        channel,
        status: "pending",
        createdAt: new Date(now).toISOString(),
        verifiedAt: null,
      };
      return NextResponse.json({ verification: started });
    }

    if (raw.action === "check") {
      const { id, code } = checkVerificationRequest.parse(raw);
      const ok = code.trim() === DEMO_OK_CODE;
      const now = Date.now();
      const checked: Verification = {
        id,
        msisdn: "",
        channel: "sms",
        status: ok ? "verified" : "failed",
        createdAt: new Date(now).toISOString(),
        verifiedAt: ok ? new Date(now).toISOString() : null,
      };
      return NextResponse.json({ verification: checked });
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
