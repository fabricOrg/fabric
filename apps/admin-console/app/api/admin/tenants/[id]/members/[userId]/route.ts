import { updateMemberRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  removeTenantMember,
  TenantMemberApiError,
  updateTenantMemberRole,
} from "@/lib/server/tenant-members-client";

/** Staff manage one tenant member: PATCH role, DELETE (soft-remove). staff:write only. */

function errorResponse(error: unknown) {
  return error instanceof TenantMemberApiError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("members_unavailable", "Member service is unavailable.", 502);
}

async function authorize() {
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can manage members.",
    );
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const badOrigin = requireTrustedOrigin(request);
  if (badOrigin) return badOrigin;
  const denied = await authorize();
  if (denied) return denied;
  const { id, userId } = await params;
  const parsed = updateMemberRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return bffUnprocessable("invalid_role", "Provide a valid role.");
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const badOrigin = requireTrustedOrigin(request);
  if (badOrigin) return badOrigin;
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
