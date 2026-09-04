import { inviteMemberRequestSchema } from "@app/contracts";
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
  inviteTenantMember,
  listTenantMembers,
  TenantMemberApiError,
} from "@/lib/server/tenant-members-client";

/**
 * Staff view/manage a tenant's members. GET needs a staff session; POST (invite) needs staff:write.
 * The tenant id is the staff-chosen path param (staff are trusted platform operators, unlike the
 * customer dashboard where the tenant is the session's own org).
 */

function errorResponse(error: unknown) {
  return error instanceof TenantMemberApiError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("members_unavailable", "Member service is unavailable.", 502);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  const { id } = await params;
  try {
    return NextResponse.json(await listTenantMembers(id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can manage members.",
    );
  }
  const { id } = await params;
  const parsed = inviteMemberRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return bffUnprocessable("invalid_request", "Enter a valid email and role.");
  }
  try {
    return NextResponse.json(await inviteTenantMember(id, parsed.data), {
      status: 201,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
