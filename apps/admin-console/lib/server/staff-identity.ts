import "server-only";

import type { AppSession, WorkOSSessionClaims } from "@app/fe-auth";

/**
 * Staff identity — coarse by design: no staff/role table exists yet (only tenant-scoped
 * `memberships` in the customer realm). Real WorkOS SSO is required to reach this app at all; who
 * counts as staff is a comma-separated email allowlist until a real staff directory is built.
 * WorkOS ties every session to SOME organization (see authenticateAndResolve in @app/fe-auth) — we
 * don't care WHICH org, only that the email is allowlisted, so staff can share the customer WorkOS
 * org or have their own; either works.
 */
function allowedStaffEmails(): Set<string> {
  return new Set(
    (process.env.STAFF_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

export async function resolveStaffSession(
  claims: WorkOSSessionClaims,
): Promise<AppSession | null> {
  const allowed = allowedStaffEmails();
  if (!allowed.has(claims.email.toLowerCase())) return null;
  return {
    userId: claims.externalUserId,
    orgId: "",
    role: "staff",
    permissions: ["staff:*"],
    sessionId: claims.sessionId,
  };
}
