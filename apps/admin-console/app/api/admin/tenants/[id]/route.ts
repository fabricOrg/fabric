import { updateTenantStatusRequestSchema } from "@app/contracts";
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
  TenantApiError,
  updateTenantStatus,
} from "@/lib/server/tenants-client";

/** Suspend / reinstate / soft-close a tenant. Origin-gated (mutation) + staff:write; audited. */
export async function PATCH(
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
      "Only staff admins can change a tenant's status.",
    );
  }

  const { id } = await params;
  const parsed = updateTenantStatusRequestSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      "Choose a status and give a reason (at least 8 characters).",
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
      : bffFailure("tenant_unavailable", "Tenant service unavailable.", 502);
  }
}
