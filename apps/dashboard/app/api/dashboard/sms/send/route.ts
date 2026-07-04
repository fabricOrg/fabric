import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

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
    const input = (await request.json()) as {
      to?: unknown;
      senderId?: unknown;
      body?: unknown;
    };
    return NextResponse.json(
      await dashboardApi("/v1/sms/send", "sms:send", {
        method: "POST",
        body: JSON.stringify({
          to: input.to,
          sender_id: input.senderId,
          body: input.body,
          currency: "GHS",
        }),
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
