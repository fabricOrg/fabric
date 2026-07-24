import type { AuthenticationResponse } from "@workos-inc/node";
import {
  errorCode,
  errorStatus,
  HOSTED_FALLBACK_CODES,
  pendingToken,
} from "./credential-errors.js";
import type { CredentialOutcome, RealmConfig } from "./types.js";
import { resolveUserSessionFromSealed } from "./user-session.js";
import { workos } from "./workos-internal.js";

/**
 * ADR-0008 — Fabric-owned auth screens. These wrap WorkOS User Management APIs so the dashboard
 * can render its own sign-in/sign-up UI while WorkOS stays the identity engine (store, hashing,
 * breach detection, auth emails, session crypto). Every success path funnels through
 * `finishAuthentication` → the SAME sealed cookie + resolve-v2 the OAuth callback produces.
 *
 * SECURITY: passwords reach these functions in flight only — never stored, never logged, never put
 * in an error message or thrown value. The caller (BFF) reads them from the request and drops them.
 */

export async function signInWithPassword(
  cfg: RealmConfig,
  input: { email: string; password: string },
): Promise<CredentialOutcome> {
  try {
    const auth = await workos(cfg).userManagement.authenticateWithPassword({
      clientId: cfg.clientId,
      email: input.email,
      password: input.password,
      session: { sealSession: true, cookiePassword: cfg.cookiePassword },
    });
    return finishAuthentication(cfg, auth);
  } catch (error) {
    return classifyAuthError(error, input.email);
  }
}

export async function signUpWithPassword(
  cfg: RealmConfig,
  input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  },
): Promise<CredentialOutcome> {
  try {
    await workos(cfg).userManagement.createUser({
      email: input.email,
      password: input.password,
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
    });
  } catch (error) {
    // 409 = the email already has an account — steer them to sign-in instead of leaking existence
    // via a distinct message (enumeration-safe: the sign-up screen shows a neutral "try signing in").
    const status = errorStatus(error);
    if (status === 409) return { status: "invalid_credentials" };
    return transientOrInvalid(error);
  }
  // Immediately authenticate; a WorkOS env that requires verification raises
  // email_verification_required (with a pending token) and auto-sends the code email.
  return signInWithPassword(cfg, {
    email: input.email,
    password: input.password,
  });
}

export async function verifyEmailCode(
  cfg: RealmConfig,
  input: { code: string; pendingAuthenticationToken: string },
): Promise<CredentialOutcome> {
  try {
    const auth = await workos(
      cfg,
    ).userManagement.authenticateWithEmailVerification({
      clientId: cfg.clientId,
      code: input.code,
      pendingAuthenticationToken: input.pendingAuthenticationToken,
      session: { sealSession: true, cookiePassword: cfg.cookiePassword },
    });
    return finishAuthentication(cfg, auth);
  } catch (error) {
    return classifyAuthError(error, null);
  }
}

/** Passwordless: email the user a one-time code. Returns false only on a genuine fault (the caller
 *  still shows the neutral "check your email" screen to avoid leaking whether the address exists). */
export async function sendMagicCode(
  cfg: RealmConfig,
  email: string,
): Promise<boolean> {
  try {
    await workos(cfg).userManagement.createMagicAuth({ email });
    return true;
  } catch {
    return false;
  }
}

export async function signInWithMagicCode(
  cfg: RealmConfig,
  input: { email: string; code: string },
): Promise<CredentialOutcome> {
  try {
    const auth = await workos(cfg).userManagement.authenticateWithMagicAuth({
      clientId: cfg.clientId,
      email: input.email,
      code: input.code,
      session: { sealSession: true, cookiePassword: cfg.cookiePassword },
    });
    return finishAuthentication(cfg, auth);
  } catch (error) {
    return classifyAuthError(error, input.email);
  }
}

// NOTE: password RESET stays on the hosted AuthKit page (ADR-0008 fallback). WorkOS v10 dropped
// `sendPasswordResetEmail`; `createPasswordReset` only mints a token and sends no email, so a
// custom reset screen would force Fabric to run its own auth mailer — out of scope. "Forgot
// password?" links to the hosted reset flow, which sends the WorkOS-branded email.

async function finishAuthentication(
  cfg: RealmConfig,
  auth: AuthenticationResponse,
): Promise<CredentialOutcome> {
  const sealedCookie = auth.sealedSession;
  if (!sealedCookie) {
    return { status: "error", message: "No session was returned." };
  }
  const session = await resolveUserSessionFromSealed(cfg, sealedCookie);
  // Authenticated with WorkOS but resolve-v2 denied (should be rare on the credential path) — treat
  // as invalid so the screen doesn't dead-end. The BFF sets NO cookie for this outcome, so the
  // sealed session never reaches the browser; the unused WorkOS session simply lapses.
  if (!session) return { status: "invalid_credentials" };
  return { status: "authenticated", session, sealedCookie };
}

function classifyAuthError(
  error: unknown,
  email: string | null,
): CredentialOutcome {
  const code = errorCode(error);
  if (code === "email_verification_required") {
    const pending = pendingToken(error);
    if (pending && email) {
      return {
        status: "verification_required",
        pendingAuthenticationToken: pending,
        email,
      };
    }
    // No pending token / email to continue with — bounce to hosted to recover.
    return { status: "fallback_hosted", reason: "email_verification_required" };
  }
  if (code && HOSTED_FALLBACK_CODES.has(code)) {
    return { status: "fallback_hosted", reason: code };
  }
  return transientOrInvalid(error);
}

/** A 4xx is a bad credential / bad code (client fault, safe to say "invalid"); a 5xx / network
 *  fault is transient — distinct so the screen shows "try again" instead of "wrong password". */
function transientOrInvalid(error: unknown): CredentialOutcome {
  const status = errorStatus(error);
  if (typeof status === "number" && status >= 400 && status < 500) {
    return { status: "invalid_credentials" };
  }
  return {
    status: "error",
    message: "Something went wrong. Please try again.",
  };
}
