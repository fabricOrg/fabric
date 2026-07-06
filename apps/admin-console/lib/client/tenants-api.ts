import type { Tenant } from "@/lib/mock-admin";

/**
 * Tenant-provisioning client. Hits the mock BFF for now.
 * TODO(BFF): promote these DTOs to @app/contracts (zod) and point at the real staff-guarded
 * POST /internal/admin/tenants once services/api implements WorkOS-org + account + invite.
 */
export interface ProvisionTenantRequest {
  name: string;
  slug: string;
  region: string;
  plan: Tenant["plan"];
  adminEmail: string;
}

export interface ProvisionTenantResult {
  tenant: Tenant;
  workosOrganizationId: string;
  invitedEmail: string;
}

export async function provisionTenant(
  input: ProvisionTenantRequest,
): Promise<ProvisionTenantResult> {
  const response = await fetch("/api/admin/tenants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload as ProvisionTenantResult;
}
