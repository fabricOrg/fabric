import type { ProvisionTenantResponse } from "@app/contracts";

/**
 * Tenant-provisioning client → the live staff-guarded BFF route (POST /api/admin/tenants), which
 * delegates to the api's /internal/admin/tenants (WorkOS org → account → first-admin invite).
 * `region` is the market region the UI selects; the BFF maps it to accounts.dataRegion.
 */
export interface ProvisionTenantInput {
  name: string;
  slug: string;
  region: string;
  plan: "free" | "growth" | "scale";
  adminEmail: string;
}

export async function provisionTenant(
  input: ProvisionTenantInput,
): Promise<ProvisionTenantResponse> {
  const response = await fetch("/api/admin/tenants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as unknown;
  // Non-2xx bodies are the shared F8.3 error envelope — hand them to toastApiError (parseApiError
  // never throws), so the caller's catch surfaces a user-safe message + request_id.
  if (!response.ok) throw payload;
  return payload as ProvisionTenantResponse;
}
