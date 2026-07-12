import { virtualPhoneReply } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  clearVirtualPhoneInbox,
  getVirtualPhoneInbox,
  sendVirtualPhoneReply,
} from "@/lib/server/virtual-phone-client";

export async function GET(request: NextRequest) {
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
    const inbox = await getVirtualPhoneInbox(
      session.orgId,
      request.nextUrl.searchParams.get("cursor") ?? undefined,
      request.nextUrl.searchParams.get("recipient") ?? undefined,
    );
    return NextResponse.json({
      ...inbox,
      can_clear: session.role === "owner" || session.role === "admin",
    });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          { error: { message: "Request failed." } },
          { status: 500 },
        );
  }
}

export async function DELETE() {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session)
    return NextResponse.json(
      { error: { message: "Sign in to continue." } },
      { status: 401 },
    );
  if (session.role !== "owner" && session.role !== "admin") {
    return NextResponse.json(
      { error: { message: "Only owners and admins can clear this inbox." } },
      { status: 403 },
    );
  }
  try {
    return NextResponse.json({
      cleared: await clearVirtualPhoneInbox(
        session.orgId,
        session.email ?? undefined,
      ),
    });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          { error: { message: "Request failed." } },
          { status: 500 },
        );
  }
}

export async function POST(request: NextRequest) {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session)
    return NextResponse.json(
      { error: { message: "Sign in to continue." } },
      { status: 401 },
    );
  if (!session.permissions.includes("sms:send")) {
    return NextResponse.json(
      { error: { message: "Your role cannot send virtual replies." } },
      { status: 403 },
    );
  }
  const parsed = virtualPhoneReply.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: { message: parsed.error.issues[0]?.message ?? "Invalid reply." },
      },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      await sendVirtualPhoneReply(session.orgId, parsed.data),
    );
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          { error: { message: "Request failed." } },
          { status: 500 },
        );
  }
}
