import { createHash } from "node:crypto";
import type {
  RealmConfig,
  UserCallbackResult,
  UserRefreshOutcome,
  UserSession,
} from "./types.js";
import { secretsEqual, workos } from "./workos-internal.js";

/**
 * ADR-0007 user-level session path. WorkOS authenticates the PERSON — no organization context is
 * requested or accepted — and the app's resolve-v2 resolver returns the person plus every
 * workspace membership. Workspace selection and per-request membership revalidation live in the
 * application (BFF), not here.
 */

export function handleUserCallback(
  cfg: RealmConfig,
  params: {
    readonly code: string;
    readonly state: string;
    readonly expectedState: string;
  },
): Promise<UserCallbackResult> {
  if (!secretsEqual(params.state, params.expectedState)) {
    return Promise.resolve({ session: null, sealedCookie: null });
  }
  return exchangeAndResolveUser(cfg, params.code);
}

/** Invalid, expired, malformed, or unauthorized sessions fail closed. */
export function readUserSession(
  cfg: RealmConfig,
  sealedCookie: string | undefined,
): Promise<UserSession | null> {
  if (!sealedCookie) return Promise.resolve(null);
  return authenticateAndResolveUser(cfg, sealedCookie).catch(() => null);
}

// Single-flight refresh de-duplication — same rationale as the org-scoped path: refresh tokens
// rotate on use, so concurrent refreshes with one cookie must share one flight and one new cookie.
const inFlightRefreshes = new Map<string, Promise<UserRefreshOutcome>>();

export function refreshUserSessionDetailed(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<UserRefreshOutcome> {
  const key = createHash("sha256")
    .update(`${cfg.realm}:user:${sealedCookie}`)
    .digest("hex")
    .slice(0, 32);
  const inFlight = inFlightRefreshes.get(key);
  if (inFlight) return inFlight;
  const flight = refreshAndClassifyUser(cfg, sealedCookie).finally(() => {
    inFlightRefreshes.delete(key);
  });
  inFlightRefreshes.set(key, flight);
  return flight;
}

export async function refreshUserSession(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<{ session: UserSession; sealedCookie: string } | null> {
  const outcome = await refreshUserSessionDetailed(cfg, sealedCookie);
  return outcome.status === "refreshed"
    ? { session: outcome.session, sealedCookie: outcome.sealedCookie }
    : null;
}

async function refreshAndClassifyUser(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<UserRefreshOutcome> {
  try {
    const loaded = workos(cfg).userManagement.loadSealedSession({
      sessionData: sealedCookie,
      cookiePassword: cfg.cookiePassword,
    });
    const refreshed = await loaded.refresh({
      cookiePassword: cfg.cookiePassword,
    });
    if (!refreshed.authenticated || !refreshed.sealedSession) {
      return { status: "terminal" };
    }
    const session = await authenticateAndResolveUser(
      cfg,
      refreshed.sealedSession,
    );
    if (!session) return { status: "terminal" };
    return {
      status: "refreshed",
      session,
      sealedCookie: refreshed.sealedSession,
    };
  } catch (error) {
    // WorkOS rejects a spent/revoked/invalid token with a 4xx — retrying cannot succeed.
    // Anything else (network fault, WorkOS 5xx, timeout) is transient: keep the cookie.
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return { status: "terminal" };
    }
    return { status: "transient" };
  }
}

async function exchangeAndResolveUser(
  cfg: RealmConfig,
  code: string,
): Promise<UserCallbackResult> {
  const response = await workos(cfg).userManagement.authenticateWithCode({
    clientId: cfg.clientId,
    code,
    session: { sealSession: true, cookiePassword: cfg.cookiePassword },
  });
  if (!response.sealedSession) {
    return { session: null, sealedCookie: null };
  }
  // `session` null with a cookie = OUR resolution denied; the caller keeps `sealedCookie` to end
  // the WorkOS session so a retry isn't stuck on this identity.
  const session = await authenticateAndResolveUser(cfg, response.sealedSession);
  return { session, sealedCookie: response.sealedSession };
}

async function authenticateAndResolveUser(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<UserSession | null> {
  const resolver = cfg.resolveUserSession;
  if (!resolver) return null;
  const result = await workos(cfg).userManagement.authenticateWithSessionCookie(
    {
      sessionData: sealedCookie,
      cookiePassword: cfg.cookiePassword,
    },
  );
  // No organization requirement — the sealed session proves WHO, nothing else (ADR-0007).
  if (!result.authenticated || !result.sessionId) return null;
  return resolver({
    externalUserId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    userUpdatedAt: result.user.updatedAt,
    emailVerified: result.user.emailVerified === true,
    sessionId: result.sessionId,
  });
}
