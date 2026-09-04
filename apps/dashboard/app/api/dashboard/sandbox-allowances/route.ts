import { sandboxAllowancesResponse } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { bffFailure } from "@/lib/server/bff-error";

export async function GET() {
  try {
    return NextResponse.json(
      sandboxAllowancesResponse.parse(
        await dashboardApi("/v1/sandbox-allowances", "wallet:read"),
      ),
    );
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure(
          "sandbox_allowances_unavailable",
          "Sandbox allowance request failed.",
        );
  }
}
