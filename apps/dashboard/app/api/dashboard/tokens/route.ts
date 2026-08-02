import { type NextRequest, NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";

/**
 * Prepaid credit balances for the CLIENT. The wallet page reads these server-side, but the send
 * composer is a client component and had no way to see them — so it gated every send on the wallet
 * alone and blocked sends the engine would happily back with tokens.
 */
export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json(await dashboardApi("/v1/tokens", "wallet:read"));
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
