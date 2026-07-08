import "server-only";

import {
  type InviteMemberRequest,
  type ListMembersResponse,
  listMembersResponseSchema,
  type MemberDto,
  memberDtoSchema,
  type UpdateMemberRequest,
} from "@app/contracts";

/**
 * Staff-side management of a TENANT's members, via the api's BffToken-guarded
 * /internal/tenants/:tenantId/members[/:userId] — the same endpoints the customer dashboard uses,
 * but here the tenant id comes from the staff-chosen URL (staff are trusted platform operators).
 * Callers must have verified a staff session (staff:read to list, staff:write to mutate).
 */
export class TenantMemberApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Tenant-member API request failed with status ${status}.`);
  }
}

function backendConfiguration() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

export async function listTenantMembers(
  tenantId: string,
): Promise<ListMembersResponse> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL(`/internal/tenants/${tenantId}/members`, baseUrl),
    { cache: "no-store", headers: { "x-bff-token": bffToken } },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new TenantMemberApiError(response.status, payload);
  return listMembersResponseSchema.parse(payload);
}

export async function inviteTenantMember(
  tenantId: string,
  request: InviteMemberRequest,
): Promise<MemberDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL(`/internal/tenants/${tenantId}/members`, baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-bff-token": bffToken },
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new TenantMemberApiError(response.status, payload);
  return memberDtoSchema.parse(payload);
}

export async function updateTenantMemberRole(
  tenantId: string,
  userId: string,
  request: UpdateMemberRequest,
): Promise<MemberDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL(`/internal/tenants/${tenantId}/members/${userId}`, baseUrl),
    {
      method: "PATCH",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-bff-token": bffToken },
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new TenantMemberApiError(response.status, payload);
  return memberDtoSchema.parse(payload);
}

export async function removeTenantMember(
  tenantId: string,
  userId: string,
): Promise<void> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL(`/internal/tenants/${tenantId}/members/${userId}`, baseUrl),
    {
      method: "DELETE",
      cache: "no-store",
      headers: { "x-bff-token": bffToken },
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    throw new TenantMemberApiError(response.status, payload);
  }
}
