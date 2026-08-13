import { updateSandboxAllowancePolicySchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { sandboxAllowanceIssueMessage } from "@/lib/sandbox-allowance-message";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  getSandboxAllowancePolicy,
  TenantApiError,
  updateSandboxAllowancePolicy,
} from "@/lib/server/tenants-client";

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
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
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can change sandbox allowances.",
      403,
    );
  }
  const parsed = updateSandboxAllowancePolicySchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    // Names the field that failed. The line this replaced described the limits generically, so a
    // missing THIRD limit produced advice about the two the operator had already got right.
    return fail(
      "invalid_request",
      sandboxAllowanceIssueMessage(parsed.error),
      422,
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
    : fail("tenant_unavailable", "Tenant service unavailable.", 502);
}
