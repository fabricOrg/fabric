import { toggleKillSwitchRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import {
  KillSwitchApiError,
  toggleKillSwitch,
} from "@/lib/server/kill-switch-client";
import { requireTrustedOrigin } from "@/lib/server/origin";

/** Toggle a kill switch. staff:write only; the reason + actor are recorded to the audit log. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can flip kill switches.",
    );
  }

  const { key } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = toggleKillSwitchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      "Provide a reason (at least 8 characters).",
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
      : bffFailure(
          "kill_switch_unavailable",
          "Kill-switch service is unavailable.",
          502,
        );
  }
}
