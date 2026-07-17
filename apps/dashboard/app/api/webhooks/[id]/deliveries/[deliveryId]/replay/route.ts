import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";
import { replayWebhookDelivery } from "@/lib/server/webhooks-client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> },
) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: { code: "invalid_origin" } },
      { status: 403 },
    );
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return NextResponse.json(
      { error: { code: "invalid_session" } },
      { status: 401 },
    );
  }
  if (
    (session.role !== "owner" && session.role !== "admin") ||
    !session.permissions.includes("api_keys:write")
  ) {
    return NextResponse.json(
      { error: { code: "insufficient_permission" } },
      { status: 403 },
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
      : NextResponse.json({ error: { code: "bff_error" } }, { status: 500 });
  }
}
