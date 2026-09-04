import "server-only";

import { apiFetch } from "./api-fetch";

/** Records the impersonation audit trail via the api (the cookie itself is set/cleared in the BFF). */
function config() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

async function record(
  action: "start" | "stop",
  body: Record<string, string>,
  actor: { email: string; staffId: string },
): Promise<void> {
  const { baseUrl, bffToken } = config();
  const response = await apiFetch(
    new URL(`/internal/admin/impersonation/${action}`, baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
        "x-actor-email": actor.email,
        "x-actor-staff-id": actor.staffId,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Impersonation ${action} audit failed (${response.status}).`,
    );
  }
}

export function recordImpersonationStart(
  body: { tenant_id: string; tenant_label: string; reason: string },
  actor: { email: string; staffId: string },
): Promise<void> {
  return record("start", body, actor);
}

export function recordImpersonationStop(
  body: { tenant_id: string; tenant_label: string },
  actor: { email: string; staffId: string },
): Promise<void> {
  return record("stop", body, actor);
}
