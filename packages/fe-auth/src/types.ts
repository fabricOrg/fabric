/**
 * Shared fe-auth types — split from index.ts (file-length guard). Runtime logic stays in
 * index.ts; these are the shapes the three app realms configure and consume.
 */

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
  /**
   * ADR-0002: an AuthKit login can come back WITHOUT an organization (fresh sign-up, or an
   * unpinned sign-in). When set, the callback asks the app which organization this identity
   * belongs to (possibly provisioning a sandbox tenant server-side), then refreshes the WorkOS
   * session into that organization. Realms without this (staff) keep denying org-less sessions.
   */
  readonly resolveOrganization?: OrganizationResolver;
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

/** Claims available from an org-less authenticated WorkOS session (pre-organization). */
export interface OrglessSessionClaims {
  readonly externalUserId: string;
  readonly email: string;
  readonly name: string | null;
  readonly userUpdatedAt: string;
  readonly emailVerified: boolean;
}

/** Returns the WorkOS organization id to refresh the session into, or null to deny. */
export type OrganizationResolver = (
  claims: OrglessSessionClaims,
) => Promise<string | null>;

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

/**
 * Typed refresh outcome — the caller's response depends on WHY a refresh failed:
 *   - `refreshed`: new access token; persist the new sealed cookie (rotation!).
 *   - `terminal`: the refresh token is spent/revoked or authorization denies — clear the cookie,
 *     send the user to login. Retrying cannot succeed.
 *   - `transient`: WorkOS/network fault — the cookie may still be good; do NOT clear it. Retry
 *     later (treating this as terminal logs users out on every provider blip).
 */
export type RefreshOutcome =
  | {
      readonly status: "refreshed";
      readonly session: AppSession;
      readonly sealedCookie: string;
    }
  | { readonly status: "terminal" }
  | { readonly status: "transient" };
