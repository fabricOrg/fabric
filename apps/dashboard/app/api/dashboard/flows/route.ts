import {
  runFlowRequest,
  runFlowResponse,
  transactionsResponse,
} from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { bffFailure, bffForbidden } from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Transactions explorer BFF → the real /v1/flows saga in services/api. GET returns the reconciled
 * feed (list + daily series from real flow_records); POST runs the verify → charge → notify flow
 * (start then confirm). The api key + BFF token authorize; POST also checks a trusted origin (CSRF).
 */
export async function GET() {
  try {
    return NextResponse.json(
      transactionsResponse.parse(
        await dashboardApi("/v1/flows", "wallet:read"),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  try {
    const body = runFlowRequest.parse(await request.json());
    return NextResponse.json(
      runFlowResponse.parse(
        await dashboardApi("/v1/flows", "wallet:read", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("bff_error", "Request failed.");
}
