import "server-only";

import {
  type InviteMemberRequest,
  type ListMembersResponse,
  listMembersResponseSchema,
  type MemberDto,
  type MembershipPermission,
  memberDtoSchema,
  type UpdateMemberRequest,
  unwrapEnvelope,
} from "@app/contracts";
import { BffError } from "./api-client";
import { API_EXTERNAL_WRITE_TIMEOUT_MS, apiFetch } from "./api-fetch";

/**
 * Team-member management via the api's BffToken-guarded `/internal/tenants/:id/members`. The tenant
 * id comes from the authenticated session (never the client), and invite is gated on owner/admin in
 * the caller — this module only carries the BFF-token boundary + response validation.
 */
function backendConfiguration() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

export async function listMembers(
  tenantId: string,
): Promise<ListMembersResponse> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await apiFetch(
    new URL(`/internal/tenants/${tenantId}/members`, baseUrl),
    { cache: "no-store", headers: { "x-bff-token": bffToken } },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new BffError(response.status, payload);
  return listMembersResponseSchema.parse(unwrapEnvelope(payload));
}

/**
 * Sends a WorkOS organization invitation, which is not idempotent — the same endpoint the admin
 * console calls, and it takes the same external-write budget for the same reason: a premature
 * deadline makes the owner retry and the invitee receive a second accept link.
 */
export async function inviteMember(
  tenantId: string,
  request: InviteMemberRequest,
  actorEmail: string | null,
): Promise<MemberDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await apiFetch(
    new URL(`/internal/tenants/${tenantId}/members`, baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
        ...(actorEmail ? { "x-actor-email": actorEmail } : {}),
      },
      body: JSON.stringify(request),
    },
    API_EXTERNAL_WRITE_TIMEOUT_MS,
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new BffError(response.status, payload);
  return memberDtoSchema.parse(unwrapEnvelope(payload));
}

export async function updateMemberRole(
  tenantId: string,
  userId: string,
  request: UpdateMemberRequest,
  actorEmail: string | null,
): Promise<MemberDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await apiFetch(
    new URL(`/internal/tenants/${tenantId}/members/${userId}`, baseUrl),
    {
      method: "PATCH",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
        ...(actorEmail ? { "x-actor-email": actorEmail } : {}),
      },
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new BffError(response.status, payload);
  return memberDtoSchema.parse(unwrapEnvelope(payload));
}

export async function setMemberPermissions(
  tenantId: string,
  userId: string,
  permissions: readonly MembershipPermission[],
  actorEmail: string | null,
): Promise<MemberDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await apiFetch(
    new URL(
      `/internal/tenants/${tenantId}/members/${userId}/permissions`,
      baseUrl,
    ),
    {
      method: "PUT",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
        ...(actorEmail ? { "x-actor-email": actorEmail } : {}),
      },
      body: JSON.stringify({ permissions }),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new BffError(response.status, payload);
  return memberDtoSchema.parse(unwrapEnvelope(payload));
}

export async function removeMember(
  tenantId: string,
  userId: string,
  actorEmail: string | null,
): Promise<void> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await apiFetch(
    new URL(`/internal/tenants/${tenantId}/members/${userId}`, baseUrl),
    {
      method: "DELETE",
      cache: "no-store",
      headers: {
        "x-bff-token": bffToken,
        ...(actorEmail ? { "x-actor-email": actorEmail } : {}),
      },
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    throw new BffError(response.status, payload);
  }
}
