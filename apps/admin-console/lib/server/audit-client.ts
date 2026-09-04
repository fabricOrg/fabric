import "server-only";

import {
  type ListAuditResponse,
  listAuditResponseSchema,
} from "@app/contracts";
import { apiFetch } from "./api-fetch";
import { unwrapEnvelope } from "./response-envelope";

/** Audit log read via the api's BffToken-guarded GET /internal/admin/audit. */
export class AuditApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Audit API request failed with status ${status}.`);
  }
}

export async function listAudit(
  opts: { limit?: number; cursor?: string } = {},
): Promise<ListAuditResponse> {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  const url = new URL("/internal/admin/audit", baseUrl);
  if (opts.limit !== undefined)
    url.searchParams.set("limit", String(opts.limit));
  if (opts.cursor) url.searchParams.set("cursor", opts.cursor);
  const response = await apiFetch(url, {
    cache: "no-store",
    headers: { "x-bff-token": bffToken },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new AuditApiError(response.status, payload);
  return listAuditResponseSchema.parse(unwrapEnvelope(payload));
}
