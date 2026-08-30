import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readDashboardUserSession,
  refreshDashboardUserSession,
} from "@/lib/server/auth";
import {
  bffForbidden,
  bffInvalidRequest,
  bffUnauthorized,
} from "@/lib/server/bff-error";
import {
  sealWorkspaceSelector,
  WORKSPACE_COOKIE,
  workspaceCookieOptions,
} from "@/lib/server/workspace-cookie";

const switchRequestSchema = z.object({ tenant_id: z.string().min(1) });

/**
 * ADR-0007 workspace switch: set the selector cookie — ONLY to a workspace the freshly resolved
 * session actually holds a membership in (fail closed). Authentication is untouched; the next
 * request's revalidation does the rest.
 */
export async function POST(request: Request) {
  const session =
    (await readDashboardUserSession()) ?? (await refreshDashboardUserSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  const parsed = switchRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return bffInvalidRequest("invalid_workspace", "A tenant_id is required.");
  }
  const membership = session.memberships.find(
    (candidate) => candidate.tenantId === parsed.data.tenant_id,
  );
  if (!membership) {
    return bffForbidden(
      "workspace_not_allowed",
      "You are not a member of that workspace.",
    );
  }
  const response = NextResponse.json({
    tenant_id: membership.tenantId,
    workspace_name: membership.workspaceName,
  });
  response.cookies.set(
    WORKSPACE_COOKIE,
    sealWorkspaceSelector(membership.tenantId),
    workspaceCookieOptions(),
  );
  return response;
}
