import { NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { bffFailure, bffUnauthorized } from "@/lib/server/bff-error";
import {
  KillSwitchApiError,
  listKillSwitches,
} from "@/lib/server/kill-switch-client";

/** List kill switches. Any staff session may view. */
export async function GET() {
  if (!(await readAdminSessionWithRefresh())) {
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  }
  try {
    return NextResponse.json(await listKillSwitches());
  } catch (error) {
    return error instanceof KillSwitchApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure(
          "kill_switch_unavailable",
          "Kill-switch service is unavailable.",
          502,
        );
  }
}
