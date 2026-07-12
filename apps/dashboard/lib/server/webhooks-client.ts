import "server-only";

import {
  type CreateWebhookEndpointResponse,
  createWebhookEndpointResponseSchema,
  listWebhookEndpointsResponseSchema,
  type WebhookEndpointDto,
} from "@app/contracts";
import { dashboardApi } from "./api-client";

/**
 * Webhook endpoint management (W-B) via the data-plane `/v1/webhooks`. dashboardApi mints a tenant
 * token from the session (ADR-0003); the tenant is the session's, never the client's. Endpoints are
 * scoped to an application-environment; the signing secret is returned ONCE at creation.
 */
export async function listWebhooks(
  applicationId?: string,
): Promise<WebhookEndpointDto[]> {
  const path = applicationId
    ? `/v1/webhooks?applicationId=${encodeURIComponent(applicationId)}`
    : "/v1/webhooks";
  const payload = await dashboardApi<unknown>(path, "api_keys:read");
  return listWebhookEndpointsResponseSchema.parse(payload).endpoints;
}

export async function createWebhook(request: {
  url: string;
  description?: string;
  applicationId: string;
  env: "sandbox" | "live";
}): Promise<CreateWebhookEndpointResponse> {
  const { applicationId, env, ...rest } = request;
  const payload = await dashboardApi<unknown>(
    "/v1/webhooks",
    "api_keys:write",
    {
      method: "POST",
      body: JSON.stringify({ ...rest, application_id: applicationId, env }),
    },
  );
  return createWebhookEndpointResponseSchema.parse(payload);
}

export async function deleteWebhook(id: string): Promise<void> {
  await dashboardApi<unknown>(
    `/v1/webhooks/${encodeURIComponent(id)}`,
    "api_keys:write",
    { method: "DELETE" },
  );
}
