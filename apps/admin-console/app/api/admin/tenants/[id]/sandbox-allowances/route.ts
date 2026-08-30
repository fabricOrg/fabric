import { updateSandboxAllowancePolicySchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { sandboxAllowanceIssueMessage } from "@/lib/sandbox-allowance-message";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  getSandboxAllowancePolicy,
  TenantApiError,
  updateSandboxAllowancePolicy,
} from "@/lib/server/tenants-client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  try {
    return NextResponse.json(
      await getSandboxAllowancePolicy((await params).id),
    );
  } catch (error) {
    return respond(error);
  }
}

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
      "Only staff admins can change sandbox allowances.",
    );
  }
  const parsed = updateSandboxAllowancePolicySchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    // Names the field that failed. The line this replaced described the limits generically, so a
    // missing THIRD limit produced advice about the two the operator had already got right.
    return bffUnprocessable(
      "invalid_request",
      sandboxAllowanceIssueMessage(parsed.error),
    );
  }
  try {
    return NextResponse.json(
      await updateSandboxAllowancePolicy((await params).id, parsed.data, {
        email: session.email ?? "unknown",
        staffId: session.userId,
      }),
    );
  } catch (error) {
    return respond(error);
  }
}

function respond(error: unknown) {
  return error instanceof TenantApiError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("tenant_unavailable", "Tenant service unavailable.", 502);
}
