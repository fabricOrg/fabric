import { updateStaffRequestSchema } from "@app/contracts";
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
  removeStaff,
  StaffApiError,
  updateStaff,
} from "@/lib/server/staff-client";

/**
 * Manage one staff member (role / suspend / remove). staff:write only. A staff admin can't change
 * their OWN access here (self-lockout guard) — another admin must; the api additionally refuses to
 * demote/suspend/remove the last active admin.
 */

function errorResponse(error: unknown) {
  return error instanceof StaffApiError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("staff_unavailable", "Staff service is unavailable.", 502);
}

async function authorize(id: string) {
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return {
      error: bffUnauthorized("invalid_session", "Staff sign-in required."),
    };
  if (!session.permissions.includes("staff:write")) {
    return {
      error: bffForbidden(
        "insufficient_permission",
        "Only staff admins can manage staff.",
      ),
    };
  }
  if (session.userId === id) {
    return {
      error: bffForbidden(
        "self_management",
        "You can't change your own access — ask another admin.",
      ),
    };
  }
  return { session };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const { id } = await params;
  const { error } = await authorize(id);
  if (error) return error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = updateStaffRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      "Provide a role or status to update.",
    );
  }
  try {
    return NextResponse.json(await updateStaff(id, parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
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
