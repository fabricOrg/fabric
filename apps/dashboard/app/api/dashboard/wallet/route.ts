import { type NextRequest, NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";

export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json(await dashboardApi("/v1/wallet", "wallet:read"));
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
