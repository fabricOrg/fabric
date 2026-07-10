import "server-only";

import {
  organizationForUserResponseSchema,
  type ResolveIdentitySessionResponse,
  resolveIdentitySessionResponseSchema,
} from "@app/contracts";
import type {
  AppSession,
  OrglessSessionClaims,
  WorkOSSessionClaims,
} from "@app/fe-auth";

function backendConfiguration() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

export async function resolveWorkOSSession(
  claims: WorkOSSessionClaims,
): Promise<AppSession | null> {
  const { baseUrl, bffToken } = backendConfiguration();
  // ADR-0003: no tenant API key — the API resolves the tenant from organization_id, which the
  // BFF took from the sealed WorkOS session it verified server-side.
  const response = await fetch(new URL("/internal/identity/session", baseUrl), {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-bff-token": bffToken,
    },
    body: JSON.stringify({
      external_user_id: claims.externalUserId,
      organization_id: claims.organizationId,
      email: claims.email,
      name: claims.name,
      user_updated_at: claims.userUpdatedAt,
      role: claims.role,
      permissions: claims.permissions,
      session_id: claims.sessionId,
    }),
  });
  if (!response.ok) {
    console.error(`Identity resolution failed with status ${response.status}.`);
    return null;
  }
  return toAppSession(
    resolveIdentitySessionResponseSchema.parse(await response.json()),
    claims.email,
  );
}

/**
 * ADR-0002: org-less login (fresh sign-up / unpinned sign-in) → which organization? The API
 * resolves an existing membership's org, or — dashboard only (`allow_provision`) — provisions a
 * sandbox tenant for a verified stranger. 403 = no workspace and signup didn't apply → null →
 * the normal access-denied path.
 */
export async function resolveOrganizationForUser(
  claims: OrglessSessionClaims,
): Promise<string | null> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL("/internal/identity/organization-for-user", baseUrl),
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
        allow_provision: true,
      }),
    },
  );
  if (!response.ok) {
    if (response.status !== 403) {
      console.error(
        `Organization resolution failed with status ${response.status}.`,
      );
    }
    return null;
  }
  const parsed = organizationForUserResponseSchema.parse(await response.json());
  return parsed.workos_organization_id;
}

function toAppSession(
  response: ResolveIdentitySessionResponse,
  email: string,
): AppSession {
  return {
    userId: response.user_id,
    orgId: response.tenant_id,
    role: response.role,
    permissions: response.permissions,
    sessionId: response.session_id,
    email,
  };
}
