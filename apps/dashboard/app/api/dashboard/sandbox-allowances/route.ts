import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";

export async function GET() {
  try {
    return NextResponse.json(
      await dashboardApi("/v1/sandbox-allowances", "wallet:read"),
    );
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          { error: { message: "Sandbox allowance request failed." } },
          { status: 500 },
        );
  }
}
