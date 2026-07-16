import { updateMemberPermissionsRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
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
    return authError("invalid_origin", "Request rejected.", 403);
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return authError("invalid_session", "Sign in again to continue.", 401);
  }
  if (session.role !== "owner" && session.role !== "admin") {
    return authError(
      "insufficient_permission",
      "Only owners and admins can manage member permissions.",
      403,
    );
  }
  const { userId } = await params;
  try {
    const parsed = updateMemberPermissionsRequestSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            type: "validation_error",
            code: "invalid_permissions",
            message:
              parsed.error.issues[0]?.message ??
              "Provide a valid permission set.",
          },
        },
        { status: 422 },
      );
    }
    const member = await setMemberPermissions(
      session.orgId,
      userId,
      parsed.data.permissions,
    );
    return NextResponse.json(member);
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          {
            error: {
              type: "api_error",
              code: "bff_error",
              message: "Request failed.",
            },
          },
          { status: 500 },
        );
  }
}

function authError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { type: "auth_error", code, message } },
    { status },
  );
}
