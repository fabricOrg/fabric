import { toggleKillSwitchRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  KillSwitchApiError,
  toggleKillSwitch,
} from "@/lib/server/kill-switch-client";
import { requireTrustedOrigin } from "@/lib/server/origin";

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

/** Toggle a kill switch. staff:write only; the reason + actor are recorded to the audit log. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can flip kill switches.",
      403,
    );
  }

  const { key } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = toggleKillSwitchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Provide a reason (at least 8 characters).",
      422,
      "validation_error",
    );
  }

  try {
    const updated = await toggleKillSwitch(key, parsed.data, {
      email: session.email ?? "unknown",
      staffId: session.userId,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return error instanceof KillSwitchApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : fail(
          "kill_switch_unavailable",
          "Kill-switch service is unavailable.",
          502,
          "api_error",
        );
  }
}
