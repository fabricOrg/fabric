import { updateMemberRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { removeMember, updateMemberRole } from "@/lib/server/members-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Manage one team member. Owner/admin only; the tenant id is the session's org (never client-
 * supplied) and the api refuses touching the owner. PATCH changes the role, DELETE soft-removes.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const gate = await authorize(request);
  if ("response" in gate) return gate.response;
  const { userId } = await params;
  try {
    const parsed = updateMemberRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return bffUnprocessable("invalid_role", "Provide a valid role.");
    }
    if (userId === gate.userId && parsed.data.role !== undefined) {
      return bffInvalidRequest(
        "self_role_change",
        "You cannot change your own role. Ask another owner or admin.",
      );
    }
    const member = await updateMemberRole(
      gate.orgId,
      userId,
      parsed.data,
      gate.email,
    );
    return NextResponse.json(member);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const gate = await authorize(request);
  if ("response" in gate) return gate.response;
  const { userId } = await params;
  if (userId === gate.userId) {
    return bffInvalidRequest(
      "self_removal",
      "You cannot remove your own workspace access.",
    );
  }
  try {
    await removeMember(gate.orgId, userId, gate.email);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Shared origin + owner/admin gate. Returns the session's orgId, or a NextResponse to return. */
async function authorize(
  request: Request,
): Promise<
  | { orgId: string; userId: string; email: string | null }
  | { response: NextResponse }
> {
  if (!hasTrustedOrigin(request)) {
    return {
      response: bffForbidden("invalid_origin", "Request rejected."),
    };
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return {
      response: bffUnauthorized(
        "invalid_session",
        "Sign in again to continue.",
      ),
    };
  }
  if (session.role !== "owner" && session.role !== "admin") {
    return {
      response: bffForbidden(
        "insufficient_permission",
        "Only owners and admins can manage members.",
      ),
    };
  }
  return {
    orgId: session.orgId,
    userId: session.userId,
    email: session.email ?? null,
  };
}

function toErrorResponse(error: unknown) {
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("bff_error", "Request failed.");
}
