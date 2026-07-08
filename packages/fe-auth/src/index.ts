import { timingSafeEqual } from "node:crypto";
import { WorkOS } from "@workos-inc/node";

export interface RealmConfig {
  readonly realm: "customer" | "staff" | "developer";
  readonly apiKey: string;
  readonly clientId: string;
  readonly cookieName: string;
  readonly cookiePassword: string;
  readonly redirectUri: string;
  readonly logoutRedirectUri: string;
  readonly cookieOptions: SessionCookieOptions;
  readonly resolveSession: SessionResolver;
}

export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly maxAge?: number;
}

/** Local claims trusted by Fabric after WorkOS identity is mapped to a Postgres tenant. */
export interface AppSession {
  readonly userId: string;
  readonly orgId: string;
  readonly role: string;
  readonly permissions: readonly string[];
  readonly sessionId: string;
  /** The signed-in identity's email (from WorkOS). Used for audit-actor attribution + display. */
  readonly email?: string;
  readonly stepUpAt?: number;
  readonly impersonation?: ImpersonationClaim;
}

export interface ImpersonationClaim {
  readonly targetTenantId: string;
  readonly targetLabel?: string;
  readonly expiresAt: number;
  readonly reason: string;
}

export type AccountLivenessCheck = (session: AppSession) => Promise<boolean>;

/** Validated WorkOS claims passed to the application-owned tenant resolver. */
export interface WorkOSSessionClaims {
  readonly externalUserId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly name: string | null;
  readonly userUpdatedAt: string;
  readonly role: string;
  readonly permissions: readonly string[];
  readonly sessionId: string;
}

export type SessionResolver = (
  claims: WorkOSSessionClaims,
) => Promise<AppSession | null>;

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

/**
 * Outcome of the OAuth callback. `session` is null when the identity authenticated with WorkOS but
 * ISN'T authorized here (e.g. not invited) — `sealedCookie` is still present so the caller can end
 * the WorkOS session (letting a retry re-prompt for a different account). Both null = the exchange
 * couldn't even establish a WorkOS session (bad/expired state or code).
 */
export interface CallbackResult {
  readonly session: AppSession | null;
  readonly sealedCookie: string | null;
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

/** Refresh-token expiry, reuse, or revoked membership fails closed. */
export function refreshSession(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<{ session: AppSession; sealedCookie: string } | null> {
  return refreshAndResolve(cfg, sealedCookie).catch(() => null);
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
  // A WorkOS session exists; `session` is null when OUR authorization (membership) denies it. The
  // caller keeps `sealedCookie` to end the WorkOS session so a retry isn't stuck on this identity.
  const session = await authenticateAndResolve(cfg, response.sealedSession);
  return { session, sealedCookie: response.sealedSession };
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

export * from "./development.js";
export * from "./impersonation.js";
