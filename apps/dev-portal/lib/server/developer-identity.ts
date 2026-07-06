import "server-only";

import type { AppSession, WorkOSSessionClaims } from "@app/fe-auth";

/**
 * Developer identity — coarse by design, matching this app's current state: API keys, webhooks,
 * and logs here are all mock data (no real per-tenant backend calls yet), so a full tenant-scoped
 * customer-realm integration (like the dashboard's) would be over-building ahead of real data. Real
 * WorkOS SSO is required to reach this app at all; who counts as a developer is a comma-separated
 * email allowlist until the data layer goes real and this becomes a genuine customer-realm surface
 * ("same realm, sibling app" — see apps/dev-portal/app/(app)/layout.tsx).
 */
function allowedDeveloperEmails(): Set<string> {
  return new Set(
    (process.env.DEVELOPER_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

export async function resolveDeveloperSession(
  claims: WorkOSSessionClaims,
): Promise<AppSession | null> {
  const allowed = allowedDeveloperEmails();
  if (!allowed.has(claims.email.toLowerCase())) return null;
  return {
    userId: claims.externalUserId,
    orgId: "",
    role: "developer",
    permissions: ["developer:*"],
    sessionId: claims.sessionId,
  };
}
