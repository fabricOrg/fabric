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
} from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";
import { readVirtualMessage } from "@/lib/server/virtual-phone-client";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in to continue.");
  }
  if (!session.permissions.includes("sms:read")) {
    return bffForbidden(
      "insufficient_permission",
      "Your role cannot update message read state.",
    );
  }
  try {
    const { messageId } = await context.params;
    await readVirtualMessage(session.orgId, messageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}
