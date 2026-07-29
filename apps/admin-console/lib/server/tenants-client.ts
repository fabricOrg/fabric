import "server-only";

import {
  type ListTenantsResponse,
  listTenantsResponseSchema,
  type SandboxAllowancePolicy,
  sandboxAllowancePolicySchema,
  type TenantSummaryDto,
  tenantSummaryDtoSchema,
  type UpdateSandboxAllowancePolicy,
  type UpdateTenantStatusRequest,
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

export async function getSandboxAllowancePolicy(
  tenantId: string,
): Promise<SandboxAllowancePolicy> {
  const { baseUrl, bffToken } = connection();
  const response = await fetch(
    new URL(`/internal/admin/tenants/${tenantId}/sandbox-allowances`, baseUrl),
    {
      cache: "no-store",
      headers: { "x-bff-token": bffToken },
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new TenantApiError(response.status, payload);
  return sandboxAllowancePolicySchema.parse(payload);
}

export async function updateSandboxAllowancePolicy(
  tenantId: string,
  request: UpdateSandboxAllowancePolicy,
  actor: { email: string; staffId: string },
): Promise<SandboxAllowancePolicy> {
  const { baseUrl, bffToken } = connection();
  const response = await fetch(
    new URL(`/internal/admin/tenants/${tenantId}/sandbox-allowances`, baseUrl),
    {
      method: "PATCH",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
        "x-actor-email": actor.email,
        "x-actor-staff-id": actor.staffId,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new TenantApiError(response.status, payload);
  return sandboxAllowancePolicySchema.parse(payload);
}

function connection(): { baseUrl: string; bffToken: string } {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
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

export async function updateTenantStatus(
  tenantId: string,
  request: UpdateTenantStatusRequest,
  actor: { email: string; staffId: string },
): Promise<TenantSummaryDto> {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  const response = await fetch(
    new URL(`/internal/admin/tenants/${tenantId}`, baseUrl),
    {
      method: "PATCH",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
        "x-actor-email": actor.email,
        "x-actor-staff-id": actor.staffId,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new TenantApiError(response.status, payload);
  return tenantSummaryDtoSchema.parse(payload);
}
