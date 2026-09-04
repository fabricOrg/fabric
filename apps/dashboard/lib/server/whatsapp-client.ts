import "server-only";

import {
  unwrapEnvelope,
  type WhatsappMessageListResponse,
  type WhatsappSendRequest,
  type WhatsappSendResponse,
  type WhatsappTemplateListResponse,
  whatsappMessageListResponse,
  whatsappSendResponse,
  whatsappTemplateListResponse,
} from "@app/contracts";
import { BffError } from "./api-client";
import { apiFetch } from "./api-fetch";

/**
 * Dashboard WhatsApp surface via the api's BffToken-guarded /internal/tenants/:id/whatsapp. The
 * workspace token can't use /v1/whatsapp/messages because that route needs application/environment
 * API-key context; the internal endpoint resolves that context server-side for the current env type.
 */
function backend() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

async function request(
  tenantId: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const { baseUrl, bffToken } = backend();
  const response = await apiFetch(
    new URL(`/internal/tenants/${tenantId}${path}`, baseUrl),
    {
      ...init,
      cache: "no-store",
      headers: {
        "x-bff-token": bffToken,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    },
  );
  const payload: unknown = unwrapEnvelope(
    await response.json().catch(() => null),
  );
  if (!response.ok) throw new BffError(response.status, payload);
  return payload;
}

export async function listWhatsappMessages(
  tenantId: string,
  env: "sandbox" | "live",
  page: { limit?: string; cursor?: string; status?: string } = {},
): Promise<WhatsappMessageListResponse> {
  const query = new URLSearchParams({ env });
  if (page.limit) query.set("limit", page.limit);
  if (page.cursor) query.set("cursor", page.cursor);
  if (page.status) query.set("status", page.status);
  return whatsappMessageListResponse.parse(
    await request(tenantId, `/whatsapp?${query.toString()}`),
  );
}

/**
 * The APPROVED template catalog for the compose picker. Parsed against the contract like every other
 * BFF read, so a malformed catalog fails here rather than rendering a picker of `undefined`.
 */
export async function listWhatsappTemplates(
  tenantId: string,
): Promise<WhatsappTemplateListResponse> {
  return whatsappTemplateListResponse.parse(
    await request(tenantId, "/whatsapp/templates"),
  );
}

export async function sendWhatsappMessage(
  tenantId: string,
  env: "sandbox" | "live",
  input: WhatsappSendRequest,
  idempotencyKey: string,
): Promise<WhatsappSendResponse> {
  return whatsappSendResponse.parse(
    await request(tenantId, `/whatsapp?env=${env}`, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(input),
    }),
  );
}
