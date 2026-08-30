import { sendSmsRequest, sendSmsResponse } from "@app/contracts";
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
    const parsed = sendSmsRequest.safeParse(await request.json());
    if (!parsed.success) {
      return invalidRequest("The send request is invalid.");
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) {
      return invalidRequest("An Idempotency-Key is required.");
    }
    return NextResponse.json(
      sendSmsResponse.parse(
        await dashboardApi("/v1/sms/messages", "sms:send", {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey },
          body: JSON.stringify(parsed.data),
        }),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function invalidRequest(message: string) {
  return bffInvalidRequest("invalid_send_request", message);
}

function errorResponse(error: unknown) {
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("bff_error", "Request failed.");
}
