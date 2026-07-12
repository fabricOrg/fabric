import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";
import { readVirtualMessage } from "@/lib/server/virtual-phone-client";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: { message: "Request rejected." } },
      { status: 403 },
    );
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return NextResponse.json(
      { error: { message: "Sign in to continue." } },
      { status: 401 },
    );
  }
  if (!session.permissions.includes("sms:read")) {
    return NextResponse.json(
      { error: { message: "Your role cannot update message read state." } },
      { status: 403 },
    );
  }
  try {
    const { messageId } = await context.params;
    await readVirtualMessage(session.orgId, messageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          { error: { message: "Request failed." } },
          { status: 500 },
        );
  }
}
