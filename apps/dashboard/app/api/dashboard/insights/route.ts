import { messagingInsightsResponse } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { bffFailure } from "@/lib/server/bff-error";

// Real Messaging Insights BFF → the data-plane /v1/messages/insights rollup (aggregated from the
// tenant's messages). Maps the API's snake_case summary to the camelCase shape the Insights tab's
// client DTO already parses. Errors propagate so the tab shows its error state, never fake numbers.
export async function GET() {
  try {
    const res = messagingInsightsResponse.parse(
      await dashboardApi("/v1/messages/insights", "sms:read"),
    );
    const s = res.summary;
    return NextResponse.json({
      summary: {
        totalSent: s.total_sent,
        delivered: s.delivered,
        failed: s.failed,
        avgSegments: s.avg_segments,
        errors: s.errors,
      },
      request_id: res.request_id,
    });
  } catch (error) {
    if (error instanceof BffError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    return bffFailure("bff_error", "Request failed.");
  }
}
