import { updateMemberRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
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
      return NextResponse.json(
        {
          error: {
            type: "validation_error",
            code: "invalid_role",
            message: "Provide a valid role.",
          },
        },
        { status: 422 },
      );
    }
    if (userId === gate.userId && parsed.data.role !== undefined) {
      return unauthorized(
        "self_role_change",
        "You cannot change your own role. Ask another owner or admin.",
        400,
      );
    }
    const member = await updateMemberRole(gate.orgId, userId, parsed.data);
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
    return unauthorized(
      "self_removal",
      "You cannot remove your own workspace access.",
      400,
    );
  }
  try {
    await removeMember(gate.orgId, userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Shared origin + owner/admin gate. Returns the session's orgId, or a NextResponse to return. */
async function authorize(
  request: Request,
): Promise<{ orgId: string; userId: string } | { response: NextResponse }> {
  if (!hasTrustedOrigin(request)) {
    return {
      response: unauthorized("invalid_origin", "Request rejected.", 403),
    };
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return {
      response: unauthorized(
        "invalid_session",
        "Sign in again to continue.",
        401,
      ),
    };
  }
  if (session.role !== "owner" && session.role !== "admin") {
    return {
      response: unauthorized(
        "insufficient_permission",
        "Only owners and admins can manage members.",
        403,
      ),
    };
  }
  return { orgId: session.orgId, userId: session.userId };
}

function toErrorResponse(error: unknown) {
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

function unauthorized(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { type: "auth_error", code, message } },
    { status },
  );
}
