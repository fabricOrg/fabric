import { inviteStaffRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  inviteStaff,
  listStaff,
  StaffApiError,
} from "@/lib/server/staff-client";

/**
 * Staff management BFF. Directly reachable at the admin origin, so every handler verifies the staff
 * session itself (the page guard isn't enough). Listing needs any staff session; inviting needs
 * staff:write (admin role) — an operator can view but not grant access.
 */

function errorResponse(error: unknown) {
  return error instanceof StaffApiError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("staff_unavailable", "Staff service is unavailable.", 502);
}

export async function GET(request: NextRequest) {
  if (!(await readAdminSessionWithRefresh())) {
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  }
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  try {
    return NextResponse.json(await listStaff(cursor ? { cursor } : {}));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session) {
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  }
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can manage staff.",
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = inviteStaffRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable("invalid_request", "Enter a valid email and role.");
  }
  try {
    return NextResponse.json(await inviteStaff(parsed.data), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
