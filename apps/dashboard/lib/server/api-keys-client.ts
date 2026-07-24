import "server-only";

import {
  type ApiKey,
  apiKey as apiKeySchema,
  type CreateApiKeyRequest,
  type CreateApiKeyResult,
  createApiKeyResult as createApiKeyResultSchema,
} from "@app/contracts";
import { z } from "zod";
import { dashboardApi } from "./api-client";

/**
 * API-key management (W-B) via the data-plane `/v1/api-keys`. dashboardApi mints a short-lived tenant
 * token from the authenticated session (ADR-0003) and enforces the membership permission before the
 * call — the tenant is the session's, never the client's. Keys mint into the workspace's default
 * application environment by type; live keys need the live environment unlocked through go-live.
 * Responses are parsed against the shared contract at the boundary.
 */
const listResponseSchema = z.array(apiKeySchema);

/** List keys, optionally narrowed to a single application (the app-detail page). */
export async function listApiKeys(applicationId?: string): Promise<ApiKey[]> {
  const path = applicationId
    ? `/v1/api-keys?applicationId=${encodeURIComponent(applicationId)}`
    : "/v1/api-keys";
  const payload = await dashboardApi<unknown>(path, "api_keys:read");
  return listResponseSchema.parse(payload);
}

/** Create a key inside a specific application's environment (ADR-0004). `expiresInDays` omitted =
 *  never expires. */
export async function createApiKey(
  request: CreateApiKeyRequest & {
    applicationId: string;
    expiresInDays?: number;
  },
): Promise<CreateApiKeyResult> {
  const { applicationId, expiresInDays, ...rest } = request;
  const payload = await dashboardApi<unknown>(
    "/v1/api-keys",
    "api_keys:write",
    {
      method: "POST",
      body: JSON.stringify({
        ...rest,
        application_id: applicationId,
        ...(expiresInDays ? { expires_in_days: expiresInDays } : {}),
      }),
    },
  );
  return createApiKeyResultSchema.parse(payload);
}

export async function revokeApiKey(id: string): Promise<void> {
  await dashboardApi<unknown>(
    `/v1/api-keys/${encodeURIComponent(id)}`,
    "api_keys:write",
    { method: "DELETE" },
  );
}
