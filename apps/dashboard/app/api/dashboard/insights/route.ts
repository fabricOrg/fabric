import { type NextRequest, NextResponse } from "next/server";

// Mock BFF stub for Messaging Insights (Twilio Messaging Insights parity). Returns a coherent,
// static analytics rollup so the Insights tab is fully exercisable before the real analytics
// service exists. Numbers are internally consistent: delivered + failed <= totalSent, and the
// per-error counts sum to `failed`.
//
// TODO(BFF): replace with dashboardApi("/v1/insights", "insights:read") once the endpoint ships.

interface MockError {
  code: string;
  description: string;
  count: number;
}

const ERRORS: readonly MockError[] = [
  { code: "30008", description: "Unknown error", count: 512 },
  { code: "30003", description: "Unreachable destination handset", count: 337 },
  { code: "30005", description: "Unknown destination handset", count: 268 },
  { code: "30006", description: "Landline or unreachable carrier", count: 154 },
  { code: "30007", description: "Message filtered by carrier", count: 89 },
  {
    code: "21610",
    description: "Recipient has unsubscribed (STOP)",
    count: 42,
  },
];

const FAILED = ERRORS.reduce((sum, e) => sum + e.count, 0); // 1,402
const DELIVERED = 23_109;
const TOTAL_SENT = 24_817; // remainder (306) is still in-flight

export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json({
      summary: {
        totalSent: TOTAL_SENT,
        delivered: DELIVERED,
        failed: FAILED,
        avgSegments: 1.4,
        errors: ERRORS,
      },
      request_id: "req_mock_insights",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(_error: unknown) {
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
