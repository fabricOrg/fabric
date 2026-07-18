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
  /** Org-agnostic session resolution (staff realm). ADR-0007 realms use resolveUserSession. */
  readonly resolveSession?: SessionResolver;
  /**
   * ADR-0007: user-level session resolution — WorkOS proves WHO, the app returns the person plus
   * every workspace membership; no organization context is ever requested from the IdP. Realms on
   * this path use readUserSession/handleUserCallback/refreshUserSession instead of the org-scoped
   * functions above.
   */
  readonly resolveUserSession?: UserSessionResolver;
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
  /** Display name supplied by WorkOS. */
  readonly name?: string;
  /** Tenant plan ("sandbox" renders the sandbox banner + gates, ADR-0002 F3). */
  readonly plan?: string;
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

/**
 * Validated WorkOS claims passed to the application-owned session resolver. ADR-0007: sessions
 * are user-level, so the IdP org/role are OPTIONAL echoes (present only while a legacy org-pinned
 * cookie is alive) — resolvers must never base authorization on them.
 */
export interface WorkOSSessionClaims {
  readonly externalUserId: string;
  readonly organizationId: string | null;
  readonly email: string;
  readonly name: string | null;
  readonly userUpdatedAt: string;
  readonly role: string | null;
  readonly permissions: readonly string[];
  readonly sessionId: string;
}

export type SessionResolver = (
  claims: WorkOSSessionClaims,
) => Promise<AppSession | null>;

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

// ---- ADR-0007 user-level sessions -------------------------------------------------------------

/** One workspace the signed-in person can enter — mirrors the resolve-v2 wire membership. */
export interface WorkspaceMembershipClaim {
  readonly tenantId: string;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
  readonly role: string;
  readonly developerAccess: boolean;
  readonly permissions: readonly string[];
  readonly plan: string;
}

/**
 * A user-level session: WHO is signed in and WHERE they may go. Carries no active workspace —
 * that selection is an application concern (workspace cookie), revalidated against `memberships`
 * on every request before any tenant credential is minted.
 */
export interface UserSession {
  readonly userId: string;
  /** WorkOS subject id — carried so BFF flows (e.g. workspace creation) can act for this identity. */
  readonly externalUserId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly memberships: readonly WorkspaceMembershipClaim[];
  readonly sessionId: string;
}

/** Validated WorkOS user claims passed to the application-owned resolve-v2 resolver. */
export interface UserSessionClaims {
  readonly externalUserId: string;
  readonly email: string;
  readonly name: string | null;
  readonly userUpdatedAt: string;
  readonly emailVerified: boolean;
  readonly sessionId: string;
}

export type UserSessionResolver = (
  claims: UserSessionClaims,
) => Promise<UserSession | null>;

/** Callback outcome for the user-level path — same sealedCookie semantics as CallbackResult. */
export interface UserCallbackResult {
  readonly session: UserSession | null;
  readonly sealedCookie: string | null;
}

/**
 * Outcome of a credential attempt (ADR-0008 — Fabric-owned auth screens). Every success ends in a
 * resolved user-level session + the sealed cookie; the other variants tell the BFF what screen to
 * show next. `fallback_hosted` is the escape hatch for challenges we don't render ourselves yet
 * (MFA / SSO / passkey / Radar) — the caller redirects to the hosted AuthKit page to finish.
 */
export type CredentialOutcome =
  | {
      readonly status: "authenticated";
      readonly session: UserSession;
      readonly sealedCookie: string;
    }
  | {
      readonly status: "verification_required";
      readonly pendingAuthenticationToken: string;
      readonly email: string;
    }
  | { readonly status: "fallback_hosted"; readonly reason: string }
  | { readonly status: "invalid_credentials" }
  | { readonly status: "error"; readonly message: string };

/** Refresh outcome for the user-level path — same semantics as RefreshOutcome. */
export type UserRefreshOutcome =
  | {
      readonly status: "refreshed";
      readonly session: UserSession;
      readonly sealedCookie: string;
    }
  | { readonly status: "terminal" }
  | { readonly status: "transient" };

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
