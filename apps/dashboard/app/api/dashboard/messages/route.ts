import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";

export async function GET() {
  try {
    return NextResponse.json(await dashboardApi("/v1/messages", "sms:read"));
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
