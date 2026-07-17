import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { listWebhookDeliveries } from "@/lib/server/webhooks-client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return NextResponse.json(
      { error: { code: "invalid_session" } },
      { status: 401 },
    );
  }
  if (!session.permissions.includes("api_keys:read")) {
    return NextResponse.json(
      { error: { code: "insufficient_permission" } },
      { status: 403 },
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
      : NextResponse.json({ error: { code: "bff_error" } }, { status: 500 });
  }
}
