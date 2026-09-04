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
import { replayWebhookDelivery } from "@/lib/server/webhooks-client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> },
) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in to continue.");
  }
  if (
    (session.role !== "owner" && session.role !== "admin") ||
    !session.permissions.includes("api_keys:write")
  ) {
    return bffForbidden(
      "insufficient_permission",
      "Only owners and admins with webhook access can replay a delivery.",
    );
  }
  try {
    const { id, deliveryId } = await params;
    return NextResponse.json({
      delivery: await replayWebhookDelivery(id, deliveryId),
    });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "The delivery could not be replayed.");
  }
}
