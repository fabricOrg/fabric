import { messageListResponse } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { bffFailure } from "@/lib/server/bff-error";

export async function GET() {
  try {
    return NextResponse.json(
      messageListResponse.parse(await dashboardApi("/v1/messages", "sms:read")),
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
