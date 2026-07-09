import "server-only";

import {
  type ListTenantsResponse,
  listTenantsResponseSchema,
} from "@app/contracts";

/**
 * Tenant list via the api's BffToken-guarded GET /internal/admin/tenants (real accounts, no mock).
 * The provisioning POST already goes real; this is the read side for the Tenants page.
 */
export class TenantApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Tenant API request failed with status ${status}.`);
  }
}

export async function listTenants(
  opts: { cursor?: string } = {},
): Promise<ListTenantsResponse> {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  const url = new URL("/internal/admin/tenants", baseUrl);
  if (opts.cursor) url.searchParams.set("cursor", opts.cursor);
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "x-bff-token": bffToken },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new TenantApiError(response.status, payload);
  return listTenantsResponseSchema.parse(payload);
}
