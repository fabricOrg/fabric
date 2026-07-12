import { deliveryMode } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";
import {
  getMessagingSettings,
  setMessagingMode,
} from "@/lib/server/virtual-phone-client";

async function session() {
  return (await readDashboardSession()) ?? (await refreshDashboardSession());
}

export async function GET() {
  const current = await session();
  if (!current)
    return NextResponse.json(
      { error: { message: "Sign in to continue." } },
      { status: 401 },
    );
  try {
    return NextResponse.json(await getMessagingSettings(current.orgId));
  } catch (error) {
    return respond(error);
  }
}

export async function PATCH(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json(
      { error: { message: "Request rejected." } },
      { status: 403 },
    );
  }
  const current = await session();
  if (!current)
    return NextResponse.json(
      { error: { message: "Sign in to continue." } },
      { status: 401 },
    );
  if (current.role !== "owner" && current.role !== "admin") {
    return NextResponse.json(
      {
        error: { message: "Only owners and admins can change delivery mode." },
      },
      { status: 403 },
    );
  }
  const parsed = deliveryMode.safeParse(
    ((await request.json()) as { delivery_mode?: unknown }).delivery_mode,
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: { message: "Invalid delivery mode." } },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await setMessagingMode(current.orgId, parsed.data, current.email),
    );
  } catch (error) {
    return respond(error);
  }
}

function respond(error: unknown) {
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : NextResponse.json(
        { error: { message: "Request failed." } },
        { status: 500 },
      );
}
