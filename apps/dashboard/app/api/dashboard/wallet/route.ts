import { walletSnapshot } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { bffFailure } from "@/lib/server/bff-error";

export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json(
      walletSnapshot.parse(await dashboardApi("/v1/wallet", "wallet:read")),
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
