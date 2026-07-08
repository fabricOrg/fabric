import { updateStaffRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSession } from "@/lib/server/auth";
import {
  removeStaff,
  StaffApiError,
  updateStaff,
} from "@/lib/server/staff-client";

/**
 * Manage one staff member (role / suspend / remove). staff:write only. A staff admin can't change
 * their OWN access here (self-lockout guard) — another admin must; the api additionally refuses to
 * demote/suspend/remove the last active admin.
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

async function authorize(id: string) {
  const session = await readAdminSession();
  if (!session)
    return { error: fail("invalid_session", "Staff sign-in required.", 401) };
  if (!session.permissions.includes("staff:write")) {
    return {
      error: fail(
        "insufficient_permission",
        "Only staff admins can manage staff.",
        403,
      ),
    };
  }
  if (session.userId === id) {
    return {
      error: fail(
        "self_management",
        "You can't change your own access — ask another admin.",
        403,
      ),
    };
  }
  return { session };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { error } = await authorize(id);
  if (error) return error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = updateStaffRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Provide a role or status to update.",
      422,
      "validation_error",
    );
  }
  try {
    return NextResponse.json(await updateStaff(id, parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { error } = await authorize(id);
  if (error) return error;
  try {
    await removeStaff(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
