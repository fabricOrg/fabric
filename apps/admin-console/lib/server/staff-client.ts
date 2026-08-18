import "server-only";

import {
  type InviteStaffRequest,
  type ListStaffResponse,
  listStaffResponseSchema,
  type StaffDto,
  staffDtoSchema,
  type UpdateStaffRequest,
} from "@app/contracts";
import { unwrapEnvelope } from "./response-envelope";

/**
 * Staff management via the api's BffToken-guarded /internal/admin/staff. Staff aren't org-scoped, so
 * an invite is purely an allowlist upsert (no WorkOS call) — the person signs in with any matching
 * WorkOS identity. Callers must have already verified a staff-admin session (staff:write).
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
  const response = await fetch(url, {
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
  const response = await fetch(new URL("/internal/admin/staff", baseUrl), {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-bff-token": bffToken },
    body: JSON.stringify(request),
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new StaffApiError(response.status, payload);
  return staffDtoSchema.parse(unwrapEnvelope(payload));
}

export async function updateStaff(
  id: string,
  patch: UpdateStaffRequest,
): Promise<StaffDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
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
  const response = await fetch(
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
