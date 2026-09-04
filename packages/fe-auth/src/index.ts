import { createHash } from "node:crypto";
import type {
  AppSession,
  CallbackResult,
  RealmConfig,
  RefreshOutcome,
} from "./types.js";
import { isUpstreamUnavailable } from "./upstream-error.js";
import { secretsEqual, workos } from "./workos-internal.js";

export * from "./credentials.js";
export * from "./staff-credentials.js";
export * from "./types.js";
export * from "./upstream-error.js";
export * from "./user-session.js";

export function buildAuthorizationUrl(
  cfg: RealmConfig,
  opts: {
    readonly state: string;
    readonly screenHint?: "sign-up" | "sign-in";
    readonly organizationId?: string;
    /**
     * OAuth provider. Default `authkit` shows the hosted page (our fallback for MFA/SSO/passkeys).
     * `GoogleOAuth` (ADR-0008) redirects STRAIGHT to Google's consent screen — no AuthKit page —
     * and returns through the same `/auth/callback`, so the custom sign-in "Continue with Google"
     * button never surfaces a WorkOS screen.
     */
    readonly provider?: "authkit" | "GoogleOAuth";
  },
): string {
  return workos(cfg).userManagement.getAuthorizationUrl({
    clientId: cfg.clientId,
    provider: opts.provider ?? "authkit",
    redirectUri: cfg.redirectUri,
    state: opts.state,
    ...(opts.screenHint ? { screenHint: opts.screenHint } : {}),
    ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
  });
}

export function handleCallback(
  cfg: RealmConfig,
  params: {
    readonly code: string;
    readonly state: string;
    readonly expectedState: string;
  },
): Promise<CallbackResult> {
  if (!secretsEqual(params.state, params.expectedState)) {
    return Promise.resolve({ session: null, sealedCookie: null });
  }
  return exchangeAndResolve(cfg, params.code);
}

/** Invalid, expired, malformed, or unauthorized sessions fail closed. */
export function readSession(
  cfg: RealmConfig,
  sealedCookie: string | undefined,
): Promise<AppSession | null> {
  if (!sealedCookie) return Promise.resolve(null);
  // A REFUSAL becomes null; an OUTAGE is rethrown. Blanket-catching both told every caller the user
  // was signed out whenever the API stalled — see UpstreamUnavailableError.
  return authenticateAndResolve(cfg, sealedCookie).catch((error: unknown) => {
    if (isUpstreamUnavailable(error)) throw error;
    return null;
  });
}

/**
 * SINGLE-FLIGHT: refresh tokens ROTATE on use, so two concurrent refreshes with the same sealed
 * cookie race — the loser presents a spent token and gets terminally rejected, bouncing a
 * signed-in user to login (classic: several parallel BFF fetches after the access token lapses).
 * Concurrent callers with the same cookie therefore share ONE in-flight refresh (and its one new
 * cookie). Keyed by cookie hash; entries clear on settle.
 */
const inFlightRefreshes = new Map<string, Promise<RefreshOutcome>>();

function refreshFlightKey(cfg: RealmConfig, sealedCookie: string): string {
  return createHash("sha256")
    .update(`${cfg.realm}:${sealedCookie}`)
    .digest("hex")
    .slice(0, 32);
}

/** Refresh with typed failure semantics + single-flight de-duplication. */
export function refreshSessionDetailed(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<RefreshOutcome> {
  const key = refreshFlightKey(cfg, sealedCookie);
  const inFlight = inFlightRefreshes.get(key);
  if (inFlight) return inFlight;
  const flight = refreshAndClassify(cfg, sealedCookie).finally(() => {
    inFlightRefreshes.delete(key);
  });
  inFlightRefreshes.set(key, flight);
  return flight;
}

async function refreshAndClassify(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<RefreshOutcome> {
  try {
    const refreshed = await refreshAndResolve(cfg, sealedCookie);
    if (refreshed === null) return { status: "terminal" };
    return { status: "refreshed", ...refreshed };
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

/**
 * Legacy null-shape wrapper (kept for existing callers): refreshed → the pair, ANY failure →
 * null. Prefer {@link refreshSessionDetailed} where terminal-vs-transient changes the response
 * (e.g. whether to clear the cookie). Shares the same single-flight.
 */
export async function refreshSession(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<{ session: AppSession; sealedCookie: string } | null> {
  const outcome = await refreshSessionDetailed(cfg, sealedCookie);
  return outcome.status === "refreshed"
    ? { session: outcome.session, sealedCookie: outcome.sealedCookie }
    : null;
}

export function buildLogout(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<{ workosLogoutUrl: string; clearCookie: string }> {
  return logoutIntent(cfg, sealedCookie);
}

async function exchangeAndResolve(
  cfg: RealmConfig,
  code: string,
): Promise<CallbackResult> {
  const response = await workos(cfg).userManagement.authenticateWithCode({
    clientId: cfg.clientId,
    code,
    session: { sealSession: true, cookiePassword: cfg.cookiePassword },
  });
  if (!response.sealedSession) {
    return { session: null, sealedCookie: null };
  }
  // `session` null with a cookie = OUR authorization denied; the caller keeps `sealedCookie` to
  // end the WorkOS session so a retry isn't stuck on this identity.
  const session = await authenticateAndResolve(cfg, response.sealedSession);
  return { session, sealedCookie: response.sealedSession };
}

/**
 * Resolve a sealed WorkOS session cookie to a staff-realm AppSession (via `resolveSession`). Shared
 * by the OAuth-callback path and the staff credential flow (staff-credentials.ts) so both funnel
 * through the same resolver — a staff sign-in and a staff Google login authorize identically.
 */
export function resolveAppSessionFromSealed(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<AppSession | null> {
  return authenticateAndResolve(cfg, sealedCookie);
}

async function authenticateAndResolve(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<AppSession | null> {
  const resolver = cfg.resolveSession;
  if (!resolver) return null;
  const result = await workos(cfg).userManagement.authenticateWithSessionCookie(
    {
      sessionData: sealedCookie,
      cookiePassword: cfg.cookiePassword,
    },
  );
  // ADR-0007: no organization/role requirement — sessions are user-level; the IdP claims are
  // passed through as optional echoes and authorization stays with the app's resolver.
  if (!result.authenticated || !result.sessionId) {
    return null;
  }
  return resolver({
    externalUserId: result.user.id,
    organizationId: result.organizationId ?? null,
    email: result.user.email,
    name: result.user.name,
    userUpdatedAt: result.user.updatedAt,
    role: result.role ?? null,
    permissions: result.permissions ?? [],
    sessionId: result.sessionId,
  });
}

async function refreshAndResolve(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<{ session: AppSession; sealedCookie: string } | null> {
  const loaded = workos(cfg).userManagement.loadSealedSession({
    sessionData: sealedCookie,
    cookiePassword: cfg.cookiePassword,
  });
  const refreshed = await loaded.refresh({
    cookiePassword: cfg.cookiePassword,
  });
  if (!refreshed.authenticated || !refreshed.sealedSession) return null;
  const session = await authenticateAndResolve(cfg, refreshed.sealedSession);
  return session ? { session, sealedCookie: refreshed.sealedSession } : null;
}

async function logoutIntent(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<{ workosLogoutUrl: string; clearCookie: string }> {
  try {
    const loaded = workos(cfg).userManagement.loadSealedSession({
      sessionData: sealedCookie,
      cookiePassword: cfg.cookiePassword,
    });
    return {
      workosLogoutUrl: await loaded.getLogoutUrl({
        returnTo: cfg.logoutRedirectUri,
      }),
      clearCookie: "",
    };
  } catch {
    return { workosLogoutUrl: cfg.logoutRedirectUri, clearCookie: "" };
  }
}

export * from "./impersonation.js";
