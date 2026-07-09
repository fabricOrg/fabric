import { updateMemberRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  removeTenantMember,
  TenantMemberApiError,
  updateTenantMemberRole,
} from "@/lib/server/tenant-members-client";

/** Staff manage one tenant member: PATCH role, DELETE (soft-remove). staff:write only. */
function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

function errorResponse(error: unknown) {
  return error instanceof TenantMemberApiError
    ? NextResponse.json(error.payload, { status: error.status })
    : fail(
        "members_unavailable",
        "Member service is unavailable.",
        502,
        "api_error",
      );
}

async function authorize() {
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can manage members.",
      403,
    );
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const denied = await authorize();
  if (denied) return denied;
  const { id, userId } = await params;
  const parsed = updateMemberRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail(
      "invalid_role",
      "Provide a valid role.",
      422,
      "validation_error",
    );
  }
  try {
    return NextResponse.json(
      await updateTenantMemberRole(id, userId, parsed.data),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const denied = await authorize();
  if (denied) return denied;
  const { id, userId } = await params;
  try {
    await removeTenantMember(id, userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
