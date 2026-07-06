import "server-only";

import type { AppSession } from "@app/fe-auth";
import { readDashboardSession } from "./auth";

export class BffError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Fabric API request failed with status ${status}.`);
  }
}

function apiConfiguration(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.API_BASE_URL;
  const apiKey = process.env.DASHBOARD_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("API_BASE_URL and DASHBOARD_API_KEY are required.");
  }
  return { baseUrl, apiKey };
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, apiKey } = apiConfiguration();
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
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

export async function verifyConfiguredTenant(expectedTenantId: string) {
  const context = await apiRequest<{
    tenant_id: string;
    scopes: string[];
    request_id: string;
  }>("/v1/context");
  if (context.tenant_id !== expectedTenantId) {
    throw new Error(
      "The dashboard API key does not belong to the configured development tenant.",
    );
  }
  return context;
}

export async function dashboardApi<T>(
  path: string,
  permission: string,
  init?: RequestInit,
): Promise<T> {
  const session = await readDashboardSession();
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
  return apiRequest<T>(path, init);
}
