import { updateTenantStatusRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  TenantApiError,
  updateTenantStatus,
} from "@/lib/server/tenants-client";

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

/** Suspend / reinstate / soft-close a tenant. Origin-gated (mutation) + staff:write; audited. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can change a tenant's status.",
      403,
    );
  }

  const { id } = await params;
  const parsed = updateTenantStatusRequestSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Choose a status and give a reason (at least 8 characters).",
      422,
      "validation_error",
    );
  }
  try {
    const updated = await updateTenantStatus(id, parsed.data, {
      email: session.email ?? "unknown",
      staffId: session.userId,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return error instanceof TenantApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : fail(
          "tenant_unavailable",
          "Tenant service unavailable.",
          502,
          "api_error",
        );
  }
}
