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
import { listWebhookDeliveries } from "@/lib/server/webhooks-client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in to continue.");
  }
  if (!session.permissions.includes("api_keys:read")) {
    return bffForbidden(
      "insufficient_permission",
      "Your role cannot read webhook deliveries.",
    );
  }
  try {
    const { id } = await params;
    const value = new URL(request.url).searchParams.get("state");
    const state =
      value === "pending" ||
      value === "delivering" ||
      value === "delivered" ||
      value === "dead"
        ? value
        : undefined;
    return NextResponse.json({
      deliveries: await listWebhookDeliveries(id, state),
    });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Webhook deliveries could not be loaded.");
  }
}
