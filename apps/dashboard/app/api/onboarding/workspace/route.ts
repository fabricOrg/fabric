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
import { createWorkspaceForUser } from "@/lib/server/identity-client";
import {
  sealWorkspaceSelector,
  WORKSPACE_COOKIE,
  workspaceCookieOptions,
} from "@/lib/server/workspace-cookie";

const onboardingRequestSchema = z.object({
  workspace_name: z.string().trim().min(1).max(120),
});

/**
 * ADR-0007 onboarding submit: create a workspace for the signed-in person (local Postgres
 * transaction, no WorkOS org) and select it. Identity comes from the verified session — never
 * the request body.
 */
export async function POST(request: Request) {
  const session =
    (await readDashboardUserSession()) ?? (await refreshDashboardUserSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  const parsed = onboardingRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return bffInvalidRequest(
      "invalid_workspace_name",
      "Give your workspace a name (up to 120 characters).",
    );
  }
  const created = await createWorkspaceForUser({
    externalUserId: session.externalUserId,
    email: session.email,
    emailVerified: session.emailVerified,
    workspaceName: parsed.data.workspace_name,
  });
  if (!created) {
    return bffForbidden(
      "workspace_creation_refused",
      "We couldn't create a workspace right now. Please try again later.",
    );
  }
  const response = NextResponse.json(created, { status: 201 });
  response.cookies.set(
    WORKSPACE_COOKIE,
    sealWorkspaceSelector(created.tenant_id),
    workspaceCookieOptions(),
  );
  return response;
}
