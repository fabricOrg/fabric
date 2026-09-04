import "server-only";

import {
  apiContextResponse,
  mintTenantTokenResponseSchema,
  unwrapEnvelope,
} from "@app/contracts";
import type { AppSession } from "@app/fe-auth";
import {
  API_EXPORT_TIMEOUT_MS,
  API_REQUEST_TIMEOUT_MS,
  apiFetch,
} from "./api-fetch";
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
const tenantTokenMints = new Map<string, Promise<string>>();

function cacheTenantToken(
  tenantId: string,
  value: { token: string; expiresAt: number },
): void {
  const now = Date.now();
  tenantTokens.set(tenantId, value);
  for (const [id, cached] of tenantTokens) {
    if (cached.expiresAt <= now) tenantTokens.delete(id);
  }
  while (tenantTokens.size > 1_000) {
    const oldest = tenantTokens.keys().next().value;
    if (oldest === undefined) break;
    tenantTokens.delete(oldest);
  }
}

async function mintTenantToken(tenantId: string): Promise<string> {
  const { baseUrl, bffToken } = apiConfiguration();
  const response = await apiFetch(
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
  const minted = mintTenantTokenResponseSchema.parse(unwrapEnvelope(payload));
  cacheTenantToken(tenantId, {
    token: minted.token,
    expiresAt: Date.now() + minted.expires_in * 1000,
  });
  return minted.token;
}

async function tenantToken(tenantId: string): Promise<string> {
  const cached = tenantTokens.get(tenantId);
  if (cached && cached.expiresAt - 30_000 > Date.now()) return cached.token;
  const inFlight = tenantTokenMints.get(tenantId);
  if (inFlight) return inFlight;
  const mint = mintTenantToken(tenantId).finally(() => {
    tenantTokenMints.delete(tenantId);
  });
  tenantTokenMints.set(tenantId, mint);
  return mint;
}

async function apiRequest(
  path: string,
  tenantId: string,
  init: RequestInit = {},
  timeoutMs: number = API_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const { baseUrl } = apiConfiguration();
  // ONE budget for the whole request, not one per fetch. The 401 path below re-issues, and a
  // per-fetch deadline gave the retry a fresh one — so a call advertised as bounded at 15s could
  // occupy a worker for 30. Composed into apiFetch's own deadline, which keeps the 504 behaviour.
  const budget = AbortSignal.timeout(timeoutMs);
  const request = async (token: string): Promise<Response> =>
    apiFetch(
      new URL(path, baseUrl),
      {
        ...init,
        cache: "no-store",
        signal: init.signal ? AbortSignal.any([init.signal, budget]) : budget,
        headers: {
          authorization: `Bearer ${token}`,
          // Only declare a JSON body when there IS one: a DELETE (no body) with content-type
          // application/json trips Fastify's empty-body parser → 400 (FST_ERR_CTP_EMPTY_JSON_BODY).
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      },
      timeoutMs,
    );

  let response = await request(await tenantToken(tenantId));
  // A 401 can mean the cached token just expired (or the signing secret rotated) — mint a
  // fresh one and retry ONCE; anything else surfaces as-is.
  if (response.status === 401) {
    tenantTokens.delete(tenantId);
    response = await request(await tenantToken(tenantId));
  }
  // 204 No Content (e.g. a DELETE) has no body — don't try to parse it. `.catch` also guards a
  // non-JSON error body so a failure still surfaces as a BffError rather than a parse throw.
  const payload =
    response.status === 204
      ? undefined
      : ((await response.json().catch(() => null)) as unknown);
  if (!response.ok) throw new BffError(response.status, payload);
  // The API wraps every JSON success in `{ data, request_id }` (contracts/envelope.ts). Unwrapping
  // HERE keeps all ~24 client modules untouched — the envelope is a transport concern, not
  // something every caller should destructure. Errors keep their own envelope and are thrown above.
  return unwrapEnvelope(payload);
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
  const context = apiContextResponse.parse(
    await apiRequest("/v1/context", expectedTenantId),
  );
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
  // The caller streams this response body itself (the statement CSV), and the deadline covers the
  // whole exchange, drain included — so an export gets the long budget rather than aborting a
  // download that was making progress.
  let response = await apiFetch(
    new URL(path, baseUrl),
    {
      cache: "no-store",
      headers: { authorization: `Bearer ${await tenantToken(session.orgId)}` },
    },
    API_EXPORT_TIMEOUT_MS,
  );
  if (response.status === 401) {
    tenantTokens.delete(session.orgId);
    response = await apiFetch(
      new URL(path, baseUrl),
      {
        cache: "no-store",
        headers: {
          authorization: `Bearer ${await tenantToken(session.orgId)}`,
        },
      },
      API_EXPORT_TIMEOUT_MS,
    );
  }
  return response;
}

export async function dashboardApi(
  path: string,
  permission: string | readonly string[],
  init?: RequestInit,
  timeoutMs?: number,
): Promise<unknown> {
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
  const required = Array.isArray(permission) ? permission : [permission];
  for (const item of required) requirePermission(session, item);
  // The tenant id comes from the resolved session — never from the client request.
  return apiRequest(path, session.orgId, init, timeoutMs);
}
