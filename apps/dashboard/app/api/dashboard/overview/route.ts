import { type NextRequest, NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";

// Overview home BFF stub. Returns a coherent mock summary directly (mock-first) so the screen is
// buildable ahead of the real endpoint. Money `minor` values are exact integer strings — never floats.
// spendByChannel sums EXACTLY to spendThisMonth (120403 + 84250 + 31820 + 15675 = 252148).
// TODO(BFF): replace mock with dashboardApi("/v1/overview", "overview:read") + errorResponse passthrough.

const MOCK = {
  messagesSent: 48213,
  deliveryRate: 0.947,
  spendThisMonth: { currency: "GHS", minor: "252148" },
  walletBalance: { currency: "GHS", minor: "487325" },
  spendByChannel: [
    { channel: "sms", spend: { currency: "GHS", minor: "120403" } },
    { channel: "whatsapp", spend: { currency: "GHS", minor: "84250" } },
    { channel: "voice", spend: { currency: "GHS", minor: "31820" } },
    { channel: "verify", spend: { currency: "GHS", minor: "15675" } },
  ],
  // Last 14 days of traffic — sent vs delivered (delivered ≤ sent). TODO(BFF): real daily rollup.
  traffic: [
    { date: "Jun 22", sent: 3120, delivered: 2960 },
    { date: "Jun 23", sent: 3480, delivered: 3300 },
    { date: "Jun 24", sent: 2980, delivered: 2810 },
    { date: "Jun 25", sent: 4100, delivered: 3910 },
    { date: "Jun 26", sent: 3760, delivered: 3560 },
    { date: "Jun 27", sent: 2210, delivered: 2050 },
    { date: "Jun 28", sent: 1980, delivered: 1870 },
    { date: "Jun 29", sent: 3620, delivered: 3450 },
    { date: "Jun 30", sent: 3980, delivered: 3790 },
    { date: "Jul 1", sent: 4460, delivered: 4270 },
    { date: "Jul 2", sent: 4210, delivered: 3990 },
    { date: "Jul 3", sent: 3890, delivered: 3660 },
    { date: "Jul 4", sent: 4620, delivered: 4400 },
    { date: "Jul 5", sent: 2510, delivered: 2380 },
  ],
  recentActivity: [
    {
      id: "cmp_9f2a",
      kind: "campaign",
      label: "July promo blast · 12,480 recipients",
      at: "2026-07-04T09:12:00.000Z",
      status: "sending",
    },
    {
      id: "msg_7b31",
      kind: "message",
      label: "+233 24 555 0142 · order confirmation",
      at: "2026-07-04T08:47:00.000Z",
      status: "delivered",
    },
    {
      id: "top_4c88",
      kind: "topup",
      label: "Wallet top-up · Paystack",
      at: "2026-07-04T07:30:00.000Z",
      status: "completed",
    },
    {
      id: "msg_5a10",
      kind: "message",
      label: "+233 20 111 8890 · OTP verification",
      at: "2026-07-03T22:05:00.000Z",
      status: "failed",
    },
    {
      id: "msg_2e74",
      kind: "message",
      label: "+233 55 903 2277 · delivery update",
      at: "2026-07-03T18:41:00.000Z",
      status: "delivered",
    },
    {
      id: "cmp_1d63",
      kind: "campaign",
      label: "Loyalty reminder · 3,204 recipients",
      at: "2026-07-03T14:20:00.000Z",
      status: "completed",
    },
  ],
} as const;

export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json(MOCK);
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
