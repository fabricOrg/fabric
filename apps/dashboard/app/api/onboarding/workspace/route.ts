import { isUpstreamUnavailable } from "@app/fe-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readDashboardUserSession,
  refreshDashboardUserSession,
} from "@/lib/server/auth";
import {
  bffFailure,
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
  let created: Awaited<ReturnType<typeof createWorkspaceForUser>>;
  try {
    created = await createWorkspaceForUser({
      externalUserId: session.externalUserId,
      email: session.email,
      emailVerified: session.emailVerified,
      workspaceName: parsed.data.workspace_name,
    });
  } catch (error) {
    // Reachable since the BFF gained deadlines. Deliberately NOT "try again": the write is not
    // idempotent, so if the timeout fired after the tenant row landed the workspace already exists
    // and a retry makes a second one. Reloading is the safe instruction.
    if (isUpstreamUnavailable(error)) {
      return bffFailure(
        "upstream_timeout",
        "We couldn't confirm whether your workspace was created. Reload before trying again — it may already exist.",
        504,
      );
    }
    throw error;
  }
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
