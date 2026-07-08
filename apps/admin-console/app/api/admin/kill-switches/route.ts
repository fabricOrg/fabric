import { NextResponse } from "next/server";
import { readAdminSession } from "@/lib/server/auth";
import {
  KillSwitchApiError,
  listKillSwitches,
} from "@/lib/server/kill-switch-client";

/** List kill switches. Any staff session may view. */
export async function GET() {
  if (!(await readAdminSession())) {
    return NextResponse.json(
      {
        error: {
          type: "auth_error",
          code: "invalid_session",
          message: "Staff sign-in required.",
        },
      },
      { status: 401 },
    );
  }
  try {
    return NextResponse.json(await listKillSwitches());
  } catch (error) {
    return error instanceof KillSwitchApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          {
            error: {
              type: "api_error",
              code: "kill_switch_unavailable",
              message: "Kill-switch service is unavailable.",
            },
          },
          { status: 502 },
        );
  }
}
