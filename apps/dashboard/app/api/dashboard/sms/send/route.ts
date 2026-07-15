import { sendSmsRequest } from "@app/contracts";
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
    const parsed = sendSmsRequest.safeParse(await request.json());
    if (!parsed.success) {
      return invalidRequest("The send request is invalid.");
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) {
      return invalidRequest("An Idempotency-Key is required.");
    }
    return NextResponse.json(
      await dashboardApi("/v1/sms/send", "sms:send", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          to: parsed.data.to,
          sender_id: parsed.data.senderId,
          body: parsed.data.body,
          currency: "GHS",
          class: parsed.data.class,
        }),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function invalidRequest(message: string) {
  return NextResponse.json(
    {
      error: {
        type: "invalid_request_error",
        code: "invalid_send_request",
        message,
      },
    },
    { status: 400 },
  );
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
