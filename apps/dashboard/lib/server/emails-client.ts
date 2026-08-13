import "server-only";

import {
  type EmailContentResponse,
  type EmailInboxResponse,
  emailContentResponse,
  emailInboxResponse,
} from "@app/contracts";
import { BffError } from "./api-client";

/**
 * Dashboard email surface via the api's BffToken-guarded /internal/tenants/:id/emails — the workspace
 * token can't use /v1/email (those require an application-scoped key). Scoped to the current
 * environment type (sandbox|live), mirroring the virtual-phone client.
 */
function backend() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken)
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  return { baseUrl, bffToken };
}

async function request(tenantId: string, path: string): Promise<unknown> {
  const { baseUrl, bffToken } = backend();
  const response = await fetch(
    new URL(`/internal/tenants/${tenantId}${path}`, baseUrl),
    { cache: "no-store", headers: { "x-bff-token": bffToken } },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new BffError(response.status, payload);
  return payload;
}

export async function listEmails(
  tenantId: string,
  env: "sandbox" | "live",
  page: { limit?: string; cursor?: string; status?: string } = {},
): Promise<EmailInboxResponse> {
  const query = new URLSearchParams({ env });
  if (page.limit) query.set("limit", page.limit);
  if (page.cursor) query.set("cursor", page.cursor);
  if (page.status) query.set("status", page.status);
  return emailInboxResponse.parse(
    await request(tenantId, `/emails?${query.toString()}`),
  );
}

export async function getEmailContent(
  tenantId: string,
  env: "sandbox" | "live",
  id: string,
): Promise<EmailContentResponse> {
  return emailContentResponse.parse(
    await request(
      tenantId,
      `/emails/${encodeURIComponent(id)}/content?env=${env}`,
    ),
  );
}
