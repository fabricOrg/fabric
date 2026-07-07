import "server-only";

import {
  type KillSwitchDto,
  killSwitchDtoSchema,
  type ListKillSwitchesResponse,
  listKillSwitchesResponseSchema,
  type ToggleKillSwitchRequest,
} from "@app/contracts";

/** Kill-switch control plane via the api's BffToken-guarded /internal/admin/kill-switches. */
export class KillSwitchApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Kill-switch API request failed with status ${status}.`);
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

export async function listKillSwitches(): Promise<ListKillSwitchesResponse> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL("/internal/admin/kill-switches", baseUrl),
    { cache: "no-store", headers: { "x-bff-token": bffToken } },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new KillSwitchApiError(response.status, payload);
  return listKillSwitchesResponseSchema.parse(payload);
}

export async function toggleKillSwitch(
  key: string,
  request: ToggleKillSwitchRequest,
  actor: { email: string; staffId: string },
): Promise<KillSwitchDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL(
      `/internal/admin/kill-switches/${encodeURIComponent(key)}`,
      baseUrl,
    ),
    {
      method: "POST",
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
  if (!response.ok) throw new KillSwitchApiError(response.status, payload);
  return killSwitchDtoSchema.parse(payload);
}
