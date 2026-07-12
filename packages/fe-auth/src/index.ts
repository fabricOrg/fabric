import { createHash, timingSafeEqual } from "node:crypto";
import { WorkOS } from "@workos-inc/node";
import type {
  AppSession,
  CallbackResult,
  RealmConfig,
  RefreshOutcome,
} from "./types.js";

export * from "./types.js";

export function buildAuthorizationUrl(
  cfg: RealmConfig,
  opts: {
    readonly state: string;
    readonly screenHint?: "sign-up" | "sign-in";
    readonly organizationId?: string;
  },
): string {
  return workos(cfg).userManagement.getAuthorizationUrl({
    clientId: cfg.clientId,
    provider: "authkit",
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
  return authenticateAndResolve(cfg, sealedCookie).catch(() => null);
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

function workos(cfg: RealmConfig): WorkOS {
  if (
    !cfg.apiKey ||
    !cfg.clientId ||
    !cfg.redirectUri ||
    !cfg.logoutRedirectUri ||
    cfg.cookiePassword.length < 32
  ) {
    throw new Error(`Invalid ${cfg.realm} WorkOS realm configuration.`);
  }
  return new WorkOS(cfg.apiKey, { clientId: cfg.clientId });
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
  let sealedCookie = response.sealedSession;
  let session = await authenticateAndResolve(cfg, sealedCookie);
  // ADR-0002: a fresh sign-up (or unpinned sign-in) authenticates ORG-LESS. Ask the app which
  // organization this identity belongs to — possibly provisioning a sandbox tenant — then
  // refresh the WorkOS session into it and resolve again. Callback-only: readSession never
  // provisions, so a stale org-less cookie can't create tenants on page loads.
  if (!session && cfg.resolveOrganization) {
    const adopted = await adoptOrganization(cfg, sealedCookie);
    if (adopted) {
      sealedCookie = adopted;
      session = await authenticateAndResolve(cfg, sealedCookie);
    }
  }
  // `session` null with a cookie = OUR authorization denied; the caller keeps `sealedCookie` to
  // end the WorkOS session so a retry isn't stuck on this identity.
  return { session, sealedCookie };
}

/** Org-less authenticated session → resolve/provision its organization → org-scoped cookie. */
async function adoptOrganization(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<string | null> {
  const result = await workos(cfg).userManagement.authenticateWithSessionCookie(
    {
      sessionData: sealedCookie,
      cookiePassword: cfg.cookiePassword,
    },
  );
  // Only a genuinely ORG-LESS authenticated session qualifies — an org-scoped session that our
  // resolver denied must stay denied (that's the invite gate, not a provisioning trigger).
  if (!result.authenticated || result.organizationId) return null;
  if (!cfg.resolveOrganization) return null;
  const organizationId = await cfg
    .resolveOrganization({
      externalUserId: result.user.id,
      email: result.user.email,
      name: result.user.name,
      userUpdatedAt: result.user.updatedAt,
      emailVerified: result.user.emailVerified === true,
    })
    .catch(() => null);
  if (!organizationId) return null;
  const loaded = workos(cfg).userManagement.loadSealedSession({
    sessionData: sealedCookie,
    cookiePassword: cfg.cookiePassword,
  });
  const refreshed = await loaded.refresh({
    cookiePassword: cfg.cookiePassword,
    organizationId,
  });
  if (!refreshed.authenticated || !refreshed.sealedSession) return null;
  return refreshed.sealedSession;
}

async function authenticateAndResolve(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<AppSession | null> {
  const result = await workos(cfg).userManagement.authenticateWithSessionCookie(
    {
      sessionData: sealedCookie,
      cookiePassword: cfg.cookiePassword,
    },
  );
  if (
    !result.authenticated ||
    !result.organizationId ||
    !result.role ||
    !result.sessionId
  ) {
    return null;
  }
  return cfg.resolveSession({
    externalUserId: result.user.id,
    organizationId: result.organizationId,
    email: result.user.email,
    name: result.user.name,
    userUpdatedAt: result.user.updatedAt,
    role: result.role,
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

function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export * from "./impersonation.js";
