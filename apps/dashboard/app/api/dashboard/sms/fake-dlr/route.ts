import { ingestAck } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
} from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  try {
    const { messageId } = (await request.json()) as { messageId?: unknown };
    if (typeof messageId !== "string") {
      return bffInvalidRequest("invalid_message_id", "Message id is required.");
    }
    const token = process.env.WEBHOOK_INGRESS_TOKEN;
    if (!token) throw new Error("WEBHOOK_INGRESS_TOKEN is required.");
    return NextResponse.json(
      ingestAck.parse(
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
      ),
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
