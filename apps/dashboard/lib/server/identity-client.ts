import "server-only";

import {
  type CreateWorkspaceResponse,
  createWorkspaceResponseSchema,
  resolveUserSessionResponseSchema,
} from "@app/contracts";
import type { UserSession, UserSessionClaims } from "@app/fe-auth";

function backendConfiguration() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

/**
 * ADR-0007 resolve-v2: user-level resolution — the API returns the person plus EVERY workspace
 * membership; no organization travels either way. 403 = unknown identity that could not be
 * signed in (e.g. unverified stranger) → null → the normal access-denied path.
 */
export async function resolveUserSessionV2(
  claims: UserSessionClaims,
): Promise<UserSession | null> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL("/internal/identity/session-v2", baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
      },
      body: JSON.stringify({
        external_user_id: claims.externalUserId,
        email: claims.email,
        name: claims.name,
        user_updated_at: claims.userUpdatedAt,
        email_verified: claims.emailVerified,
        session_id: claims.sessionId,
      }),
    },
  );
  if (!response.ok) {
    if (response.status !== 403) {
      console.error(
        `User session resolution failed with status ${response.status}.`,
      );
    }
    return null;
  }
  const parsed = resolveUserSessionResponseSchema.parse(await response.json());
  return {
    userId: parsed.user_id,
    externalUserId: claims.externalUserId,
    emailVerified: claims.emailVerified,
    email: parsed.email,
    name: parsed.name,
    sessionId: parsed.session_id,
    memberships: parsed.memberships.map((membership) => ({
      tenantId: membership.tenant_id,
      workspaceName: membership.workspace_name,
      workspaceSlug: membership.workspace_slug,
      role: membership.role,
      developerAccess: membership.developer_access,
      permissions: membership.permissions,
      plan: membership.plan,
    })),
  };
}

/** ADR-0007 onboarding submit: local-only workspace creation. Null = refused (gates/kill-switch). */
export async function createWorkspaceForUser(input: {
  externalUserId: string;
  email: string;
  emailVerified: boolean;
  workspaceName: string;
}): Promise<CreateWorkspaceResponse | null> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL("/internal/identity/workspaces", baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
      },
      body: JSON.stringify({
        external_user_id: input.externalUserId,
        email: input.email,
        email_verified: input.emailVerified,
        workspace_name: input.workspaceName,
      }),
    },
  );
  if (!response.ok) {
    if (response.status !== 403) {
      console.error(
        `Workspace creation failed with status ${response.status}.`,
      );
    }
    return null;
  }
  return createWorkspaceResponseSchema.parse(await response.json());
}
