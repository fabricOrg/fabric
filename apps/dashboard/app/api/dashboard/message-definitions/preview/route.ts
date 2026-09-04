import { previewMessageRequest } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { previewMessage } from "@/lib/server/message-definitions-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Preview a released definition. Any authenticated member (read-only, no side effects). */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  try {
    const parsed = previewMessageRequest.safeParse(await request.json());
    if (!parsed.success) {
      return bffUnprocessable(
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid preview.",
      );
    }
    return NextResponse.json(await previewMessage(parsed.data));
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}
