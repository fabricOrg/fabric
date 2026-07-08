import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Transactions explorer BFF → the real /v1/flows saga in services/api. GET returns the reconciled
 * feed (list + daily series from real flow_records); POST runs the verify → charge → notify flow
 * (start then confirm). The api key + BFF token authorize; POST also checks a trusted origin (CSRF).
 */
export async function GET() {
  try {
    return NextResponse.json(await dashboardApi("/v1/flows", "wallet:read"));
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
    const body = (await request.json()) as unknown;
    return NextResponse.json(
      await dashboardApi("/v1/flows", "wallet:read", {
        method: "POST",
        body: JSON.stringify(body),
      }),
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
