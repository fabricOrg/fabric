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
    const { messageId } = (await request.json()) as { messageId?: unknown };
    if (typeof messageId !== "string") {
      return NextResponse.json(
        {
          error: {
            type: "invalid_request_error",
            code: "invalid_message_id",
            message: "Message id is required.",
          },
        },
        { status: 400 },
      );
    }
    const token = process.env.WEBHOOK_INGRESS_TOKEN;
    if (!token) throw new Error("WEBHOOK_INGRESS_TOKEN is required.");
    return NextResponse.json(
      await dashboardApi("/webhooks/dlr/fake-sms", "sms:send", {
        method: "POST",
        headers: { "x-webhook-token": token },
        body: JSON.stringify({
          providerRef: `fake-${messageId}`,
          status: "delivered",
          occurredAt: new Date().toISOString(),
          segments: 1,
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
