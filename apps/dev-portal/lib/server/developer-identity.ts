import "server-only";

import {
  type ResolveIdentitySessionResponse,
  resolveIdentitySessionResponseSchema,
} from "@app/contracts";
import type { AppSession, WorkOSSessionClaims } from "@app/fe-auth";

/**
 * Developer identity — a developer IS a customer-realm tenant member, so this resolves against the
 * SAME `/internal/identity/session` the dashboard uses (real `memberships`, no separate table or
 * allowlist). The extra gate: the dev-portal manages API keys + webhooks, so we require an
 * API-capable role — the resolved permissions must include an `api_keys:*` scope (owner/admin have
 * it; plain members don't). Mirrors the dashboard's identity-client.ts.
 */
const API_ACCESS_PERMISSIONS = ["api_keys:read", "api_keys:write"];

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

export async function resolveDeveloperSession(
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
    if (response.status !== 403) {
      console.error(
        `Developer resolution failed with status ${response.status}.`,
      );
    }
    return null;
  }
  const resolved = resolveIdentitySessionResponseSchema.parse(
    await response.json(),
  );
  // Gate on API access — a plain member (no api_keys scope) has no business in the dev-portal.
  if (!resolved.permissions.some((p) => API_ACCESS_PERMISSIONS.includes(p))) {
    return null;
  }
  return toAppSession(resolved);
}

function toAppSession(response: ResolveIdentitySessionResponse): AppSession {
  return {
    userId: response.user_id,
    orgId: response.tenant_id,
    role: response.role,
    permissions: response.permissions,
    sessionId: response.session_id,
  };
}
