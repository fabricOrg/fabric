import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { getVirtualPhoneInbox } from "@/lib/server/virtual-phone-client";

export async function GET() {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session)
    return NextResponse.json(
      { error: { message: "Sign in to continue." } },
      { status: 401 },
    );
  if (!session.permissions.includes("sms:read")) {
    return NextResponse.json(
      { error: { message: "Your role cannot read message content." } },
      { status: 403 },
    );
  }
  try {
    return NextResponse.json(await getVirtualPhoneInbox(session.orgId));
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          { error: { message: "Request failed." } },
          { status: 500 },
        );
  }
}
