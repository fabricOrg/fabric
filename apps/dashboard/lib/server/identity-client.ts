import "server-only";

import {
  type ResolveIdentitySessionResponse,
  resolveIdentitySessionResponseSchema,
} from "@app/contracts";
import type { AppSession, WorkOSSessionClaims } from "@app/fe-auth";

function backendConfiguration() {
  const baseUrl = process.env.API_BASE_URL;
  const apiKey = process.env.DASHBOARD_API_KEY;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !apiKey || !bffToken) {
    throw new Error(
      "API_BASE_URL, DASHBOARD_API_KEY, and BFF_INTERNAL_TOKEN are required.",
    );
  }
  return { baseUrl, apiKey, bffToken };
}

export async function resolveWorkOSSession(
  claims: WorkOSSessionClaims,
): Promise<AppSession | null> {
  const { baseUrl, apiKey, bffToken } = backendConfiguration();
  const response = await fetch(new URL("/internal/identity/session", baseUrl), {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${apiKey}`,
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
