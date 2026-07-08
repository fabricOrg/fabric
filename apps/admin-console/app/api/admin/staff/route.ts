import { inviteStaffRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSession } from "@/lib/server/auth";
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
function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

function errorResponse(error: unknown) {
  return error instanceof StaffApiError
    ? NextResponse.json(error.payload, { status: error.status })
    : fail(
        "staff_unavailable",
        "Staff service is unavailable.",
        502,
        "api_error",
      );
}

export async function GET() {
  if (!(await readAdminSession())) {
    return fail("invalid_session", "Staff sign-in required.", 401);
  }
  try {
    return NextResponse.json(await listStaff());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await readAdminSession();
  if (!session) {
    return fail("invalid_session", "Staff sign-in required.", 401);
  }
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can manage staff.",
      403,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = inviteStaffRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Enter a valid email and role.",
      422,
      "validation_error",
    );
  }
  try {
    return NextResponse.json(await inviteStaff(parsed.data), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
