import { DEFAULT_RATES, encodeAndSegment, rateSegments } from "@app/domain";
import { type NextRequest, NextResponse } from "next/server";
import {
  type Campaign,
  createCampaignRequest,
} from "@/lib/client/campaigns-api";
import { BffError } from "@/lib/server/api-client";

// Campaigns BFF stub (mock-first — no real backend yet). Returns hand-shaped JSON that satisfies the
// app-local zod DTOs. Delivery counters keep the invariant delivered + failed ≤ sent ≤ audienceSize.
// TODO(BFF): replace mock with dashboardApi("/v1/campaigns", "campaigns:read" | "campaigns:write").

const CURRENCY = "GHS" as const;

/** Exact estimate (bigint minor): per-segment rate × segments(body) × recipients — never float. */
function estimateMinor(body: string, recipients: number): bigint {
  const segments = body.length > 0 ? encodeAndSegment(body).segments : 1;
  const perSegment = rateSegments(1, CURRENCY, DEFAULT_RATES);
  return perSegment * BigInt(segments) * BigInt(recipients);
}

function mockCampaign(
  overrides: Pick<Campaign, "id" | "name" | "status" | "body"> & {
    audienceSize: number;
    sent: number;
    delivered: number;
    failed: number;
    optedOut: number;
    scheduledAt: string | null;
    createdAt: string;
  },
): Campaign {
  return {
    ...overrides,
    costEstimate: {
      currency: CURRENCY,
      minor: estimateMinor(overrides.body, overrides.audienceSize).toString(),
    },
  };
}

const NOW = Date.now();
const day = 86_400_000;

const MOCK_CAMPAIGNS: readonly Campaign[] = [
  mockCampaign({
    id: "cmp_ke7f2a",
    name: "October flash sale",
    status: "completed",
    body: "Fabric flash sale! 20% off all bundles today only. Reply STOP to opt out.",
    audienceSize: 12_480,
    sent: 12_480,
    delivered: 11_932,
    failed: 548,
    optedOut: 143,
    scheduledAt: new Date(NOW - 6 * day).toISOString(),
    createdAt: new Date(NOW - 6 * day).toISOString(),
  }),
  mockCampaign({
    id: "cmp_9b3d1c",
    name: "Payday reminder",
    status: "sending",
    body: "Hi! Your Fabric wallet top-up bonus ends at midnight. Top up now to claim.",
    audienceSize: 8_200,
    sent: 5_310,
    delivered: 4_980,
    failed: 121,
    optedOut: 47,
    scheduledAt: null,
    createdAt: new Date(NOW - 40 * 60 * 1000).toISOString(),
  }),
  mockCampaign({
    id: "cmp_4a8e60",
    name: "New feature announcement",
    status: "scheduled",
    body: "Something new is coming to Fabric. Be the first to try it this Friday.",
    audienceSize: 3_150,
    sent: 0,
    delivered: 0,
    failed: 0,
    optedOut: 0,
    scheduledAt: new Date(NOW + 2 * day).toISOString(),
    createdAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
  }),
  mockCampaign({
    id: "cmp_1f0c22",
    name: "Weekend promo (draft)",
    status: "draft",
    body: "",
    audienceSize: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    optedOut: 0,
    scheduledAt: null,
    createdAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
  }),
  mockCampaign({
    id: "cmp_77bd9e",
    name: "Loyalty thank-you",
    status: "completed",
    body: "Thank you for being a Fabric customer. Here's GHS 5 off your next order.",
    audienceSize: 6_040,
    sent: 6_040,
    delivered: 5_886,
    failed: 154,
    optedOut: 62,
    scheduledAt: new Date(NOW - 20 * day).toISOString(),
    createdAt: new Date(NOW - 20 * day).toISOString(),
  }),
  mockCampaign({
    id: "cmp_2c5a48",
    name: "Provider outage retry",
    status: "failed",
    body: "Reminder: your subscription renews tomorrow. Manage it in the Fabric app.",
    audienceSize: 4_500,
    sent: 890,
    delivered: 0,
    failed: 890,
    optedOut: 12,
    scheduledAt: new Date(NOW - 3 * day).toISOString(),
    createdAt: new Date(NOW - 3 * day).toISOString(),
  }),
];

export async function GET() {
  try {
    return NextResponse.json({ campaigns: MOCK_CAMPAIGNS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = createCampaignRequest.parse(await request.json());
    // Respecting opt-outs shrinks the addressable audience (promotional suppression list, mocked ~1.5%).
    const reachable = input.respectOptOuts
      ? Math.floor(input.audienceSize * 0.985)
      : input.audienceSize;
    const scheduled = input.scheduledAt !== null;
    const created: Campaign = {
      id: `cmp_${Math.random().toString(16).slice(2, 8)}`,
      name: input.name,
      status: scheduled ? "scheduled" : "sending",
      audienceSize: reachable,
      // Now-sends begin immediately (a small in-flight batch); scheduled sends start at zero.
      sent: scheduled ? 0 : Math.min(reachable, Math.ceil(reachable * 0.05)),
      delivered: 0,
      failed: 0,
      optedOut: input.respectOptOuts ? input.audienceSize - reachable : 0,
      body: input.body,
      scheduledAt: input.scheduledAt,
      createdAt: new Date().toISOString(),
      costEstimate: {
        currency: CURRENCY,
        minor: estimateMinor(input.body, reachable).toString(),
      },
    };
    return NextResponse.json({ campaign: created }, { status: 201 });
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
