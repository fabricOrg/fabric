import { overviewResponse } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { bffFailure } from "@/lib/server/bff-error";

export async function GET() {
  try {
    const overview = overviewResponse.parse(
      await dashboardApi("/v1/overview", ["sms:read", "wallet:read"]),
    );
    return NextResponse.json(overview);
  } catch (error) {
    if (error instanceof BffError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    return bffFailure("bff_error", "Request failed.");
  }
}
