import { updateMemberPermissionsRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { setMemberPermissions } from "@/lib/server/members-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Set a member's exact permission set (per-user override). Owner/admin only; the tenant is the
 * session's org, never client-supplied, and the api refuses editing the owner. Per the chosen model
 * any admin may grant any permission (an escalation trade-off enforced deliberately upstream).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  if (session.role !== "owner" && session.role !== "admin") {
    return bffForbidden(
      "insufficient_permission",
      "Only owners and admins can manage member permissions.",
    );
  }
  const { userId } = await params;
  try {
    const parsed = updateMemberPermissionsRequestSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return bffUnprocessable(
        "invalid_permissions",
        parsed.error.issues[0]?.message ?? "Provide a valid permission set.",
      );
    }
    const member = await setMemberPermissions(
      session.orgId,
      userId,
      parsed.data.permissions,
      session.email ?? null,
    );
    return NextResponse.json(member);
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}
