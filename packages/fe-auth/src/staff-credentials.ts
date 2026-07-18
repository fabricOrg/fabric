import {
  errorCode,
  errorStatus,
  HOSTED_FALLBACK_CODES,
} from "./credential-errors.js";
import { resolveAppSessionFromSealed } from "./index.js";
import type { RealmConfig, StaffCredentialOutcome } from "./types.js";
import { workos } from "./workos-internal.js";

/**
 * ADR-0008 — Fabric-owned STAFF sign-in for the admin console. Same idea as the customer credential
 * flow: the BFF calls WorkOS User Management, so the hosted AuthKit page (and its organization-
 * selection screen) never appears. Authorization stays the allowlist: resolveSession returns null
 * for anyone not in staff_users, which we surface as invalid_credentials.
 *
 * SECURITY: the password transits in flight only — never stored, logged, or thrown.
 */
export async function signInStaffWithPassword(
  cfg: RealmConfig,
  input: { email: string; password: string },
): Promise<StaffCredentialOutcome> {
  try {
    const auth = await workos(cfg).userManagement.authenticateWithPassword({
      clientId: cfg.clientId,
      email: input.email,
      password: input.password,
      session: { sealSession: true, cookiePassword: cfg.cookiePassword },
    });
    const sealedCookie = auth.sealedSession;
    if (!sealedCookie) {
      return { status: "error", message: "No session was returned." };
    }
    const session = await resolveAppSessionFromSealed(cfg, sealedCookie);
    // Authenticated with WorkOS but not on the staff allowlist → denied (no cookie is set by the
    // caller, so the unused WorkOS session just lapses).
    if (!session) return { status: "invalid_credentials" };
    return { status: "authenticated", session, sealedCookie };
  } catch (error) {
    // Any residual challenge (MFA / SSO / org selection / Radar) → hand off to hosted AuthKit.
    const code = errorCode(error);
    if (code && HOSTED_FALLBACK_CODES.has(code)) {
      return { status: "fallback_hosted", reason: code };
    }
    const status = errorStatus(error);
    if (typeof status === "number" && status >= 400 && status < 500) {
      return { status: "invalid_credentials" };
    }
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }
}
