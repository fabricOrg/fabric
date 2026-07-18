/** Shared WorkOS error introspection for the credential flows (user + staff). */

// Challenge codes we do NOT render ourselves — the caller hands off to hosted AuthKit to finish
// (MFA / SSO / passkeys / Radar / org selection). Custom UI is the happy path; hosted is the edge.
export const HOSTED_FALLBACK_CODES = new Set([
  "mfa_enrollment",
  "mfa_challenge",
  "mfa_verification",
  "sso_required",
  "organization_selection_required",
  "radar_email_challenge",
  "radar_sms_challenge",
]);

export function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export function pendingToken(error: unknown): string | null {
  const token = (error as { pendingAuthenticationToken?: unknown })
    .pendingAuthenticationToken;
  return typeof token === "string" ? token : null;
}
