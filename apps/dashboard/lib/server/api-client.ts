import "server-only";

import { mintTenantTokenResponseSchema } from "@app/contracts";
import type { AppSession } from "@app/fe-auth";
import { readDashboardSession, refreshDashboardSession } from "./auth";

export class BffError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Fabric API request failed with status ${status}.`);
  }
}

function apiConfiguration(): { baseUrl: string; bffToken: string } {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

// ADR-0003: the data-plane credential is a short-lived tenant token minted on demand — no
// stored per-tenant secret. Cached per tenant in process memory; refreshed 30s before expiry.
const tenantTokens = new Map<string, { token: string; expiresAt: number }>();

async function mintTenantToken(tenantId: string): Promise<string> {
  const { baseUrl, bffToken } = apiConfiguration();
  const response = await fetch(
    new URL("/internal/identity/tenant-token", baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
      },
      body: JSON.stringify({ tenant_id: tenantId }),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new BffError(response.status, payload);
  const minted = mintTenantTokenResponseSchema.parse(payload);
  tenantTokens.set(tenantId, {
    token: minted.token,
    expiresAt: Date.now() + minted.expires_in * 1000,
  });
  return minted.token;
}

async function tenantToken(tenantId: string): Promise<string> {
  const cached = tenantTokens.get(tenantId);
  if (cached && cached.expiresAt - 30_000 > Date.now()) return cached.token;
  return mintTenantToken(tenantId);
}

async function apiRequest<T>(
  path: string,
  tenantId: string,
  init: RequestInit = {},
): Promise<T> {
  const { baseUrl } = apiConfiguration();
  const request = async (token: string): Promise<Response> =>
    fetch(new URL(path, baseUrl), {
      ...init,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });

  let response = await request(await tenantToken(tenantId));
  // A 401 can mean the cached token just expired (or the signing secret rotated) — mint a
  // fresh one and retry ONCE; anything else surfaces as-is.
  if (response.status === 401) {
    tenantTokens.delete(tenantId);
    response = await request(await mintTenantToken(tenantId));
  }
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new BffError(response.status, payload);
  return payload as T;
}

function requirePermission(session: AppSession, permission: string): void {
  if (!session.permissions.includes(permission)) {
    throw new BffError(403, {
      error: {
        type: "auth_error",
        code: "insufficient_permission",
        message: "Your session does not allow this operation.",
      },
    });
  }
}

/** Development-login sanity check: the configured tenant must exist + be active + be reachable
 *  with a freshly minted tenant token. */
export async function verifyConfiguredTenant(expectedTenantId: string) {
  const context = await apiRequest<{
    tenant_id: string;
    scopes: string[];
    request_id: string;
  }>("/v1/context", expectedTenantId);
  if (context.tenant_id !== expectedTenantId) {
    throw new Error(
      "The minted tenant token does not resolve to the configured development tenant.",
    );
  }
  return context;
}

/** Raw variant for non-JSON payloads (CSV statement): same session + permission + tenant-token
 *  path, returns the upstream Response for streaming through. */
export async function dashboardApiRaw(
  path: string,
  permission: string,
): Promise<Response> {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    throw new BffError(401, {
      error: {
        type: "auth_error",
        code: "invalid_session",
        message: "Sign in again to continue.",
      },
    });
  }
  requirePermission(session, permission);
  const { baseUrl } = apiConfiguration();
  let response = await fetch(new URL(path, baseUrl), {
    cache: "no-store",
    headers: { authorization: `Bearer ${await tenantToken(session.orgId)}` },
  });
  if (response.status === 401) {
    tenantTokens.delete(session.orgId);
    response = await fetch(new URL(path, baseUrl), {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${await mintTenantToken(session.orgId)}`,
      },
    });
  }
  return response;
}

export async function dashboardApi<T>(
  path: string,
  permission: string,
  init?: RequestInit,
): Promise<T> {
  // Expired access token? Try a silent refresh (swaps the refresh token, re-seals the cookie) before
  // giving up — otherwise an idle tab's next BFF call dead-ends at 401 mid-session.
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    throw new BffError(401, {
      error: {
        type: "auth_error",
        code: "invalid_session",
        message: "Sign in again to continue.",
      },
    });
  }
  requirePermission(session, permission);
  // The tenant id comes from the resolved session — never from the client request.
  return apiRequest<T>(path, session.orgId, init);
}
