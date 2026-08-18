import "server-only";

import {
  type ResolveStaffSessionResponse,
  resolveStaffSessionResponseSchema,
} from "@app/contracts";
import type { AppSession, WorkOSSessionClaims } from "@app/fe-auth";
import { unwrapEnvelope } from "./response-envelope";

/**
 * Staff identity — resolved against the platform `staff_users` allowlist table via the api's
 * BffToken-guarded `/internal/identity/staff-session` (no tenant / api key — staff aren't tenant
 * users). A valid WorkOS login is necessary but not sufficient; the email must be a provisioned,
 * active staff member. Mirrors the dashboard's identity-client.ts boundary-validation shape.
 */
function backendConfiguration() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

export async function resolveStaffSession(
  claims: WorkOSSessionClaims,
): Promise<AppSession | null> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL("/internal/identity/staff-session", baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
      },
      body: JSON.stringify({
        external_user_id: claims.externalUserId,
        email: claims.email,
        name: claims.name,
        user_updated_at: claims.userUpdatedAt,
        session_id: claims.sessionId,
      }),
    },
  );
  if (!response.ok) {
    // 403 = not on the allowlist (expected); anything else is a real fault worth logging.
    if (response.status !== 403) {
      console.error(`Staff resolution failed with status ${response.status}.`);
    }
    return null;
  }
  return toAppSession(
    resolveStaffSessionResponseSchema.parse(
      unwrapEnvelope(await response.json()),
    ),
    claims.email,
    claims.name,
  );
}

function toAppSession(
  response: ResolveStaffSessionResponse,
  email: string,
  name: string | null,
): AppSession {
  return {
    userId: response.staff_user_id,
    orgId: "",
    role: response.role,
    permissions: response.permissions,
    sessionId: response.session_id,
    email,
    name: name ?? undefined,
  };
}
