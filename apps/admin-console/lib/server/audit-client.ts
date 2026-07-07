import "server-only";

import {
  type ListAuditResponse,
  listAuditResponseSchema,
} from "@app/contracts";

/** Audit log read via the api's BffToken-guarded GET /internal/admin/audit. */
export class AuditApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Audit API request failed with status ${status}.`);
  }
}

export async function listAudit(): Promise<ListAuditResponse> {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  const response = await fetch(new URL("/internal/admin/audit", baseUrl), {
    cache: "no-store",
    headers: { "x-bff-token": bffToken },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new AuditApiError(response.status, payload);
  return listAuditResponseSchema.parse(payload);
}
