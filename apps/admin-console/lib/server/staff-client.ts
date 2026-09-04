import "server-only";

import {
  type InviteStaffRequest,
  type ListStaffResponse,
  listStaffResponseSchema,
  type StaffDto,
  staffDtoSchema,
  type UpdateStaffRequest,
} from "@app/contracts";
import { API_EXTERNAL_WRITE_TIMEOUT_MS, apiFetch } from "./api-fetch";
import { unwrapEnvelope } from "./response-envelope";

/**
 * Staff management via the api's BffToken-guarded /internal/admin/staff. Staff aren't org-scoped, so
 * an invite is an allowlist upsert plus an ORG-LESS WorkOS invitation, sent best-effort by the API
 * (`StaffService.invite`) so a net-new operator gets an onboarding email; the allowlist row remains
 * the source of truth for authz. Callers must have already verified a staff-admin session
 * (staff:write).
 */
export class StaffApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Staff API request failed with status ${status}.`);
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

export async function listStaff(
  opts: { cursor?: string } = {},
): Promise<ListStaffResponse> {
  const { baseUrl, bffToken } = backendConfiguration();
  const url = new URL("/internal/admin/staff", baseUrl);
  if (opts.cursor) url.searchParams.set("cursor", opts.cursor);
  const response = await apiFetch(url, {
    cache: "no-store",
    headers: { "x-bff-token": bffToken },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new StaffApiError(response.status, payload);
  return listStaffResponseSchema.parse(unwrapEnvelope(payload));
}

export async function inviteStaff(
  request: InviteStaffRequest,
): Promise<StaffDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  // The allowlist upsert is idempotent, but the org-less WorkOS invitation that follows it is not:
  // a deadline firing on a slow WorkOS makes the operator retry and the invitee get a second email.
  const response = await apiFetch(
    new URL("/internal/admin/staff", baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-bff-token": bffToken },
      body: JSON.stringify(request),
    },
    API_EXTERNAL_WRITE_TIMEOUT_MS,
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new StaffApiError(response.status, payload);
  return staffDtoSchema.parse(unwrapEnvelope(payload));
}

export async function updateStaff(
  id: string,
  patch: UpdateStaffRequest,
): Promise<StaffDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await apiFetch(
    new URL(`/internal/admin/staff/${id}`, baseUrl),
    {
      method: "PATCH",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-bff-token": bffToken },
      body: JSON.stringify(patch),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new StaffApiError(response.status, payload);
  return staffDtoSchema.parse(unwrapEnvelope(payload));
}

export async function removeStaff(id: string): Promise<void> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await apiFetch(
    new URL(`/internal/admin/staff/${id}`, baseUrl),
    {
      method: "DELETE",
      cache: "no-store",
      headers: { "x-bff-token": bffToken },
    },
  );
  if (!response.ok) {
    throw new StaffApiError(
      response.status,
      (await response.json()) as unknown,
    );
  }
}
