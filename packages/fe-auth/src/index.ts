// @app/fe-auth — the SHARED frontend auth/BFF session mechanism. WHY a dedicated package: SSO and
// session security cannot be retrofitted, and three Next.js surfaces (admin-console, dev-portal,
// dashboard) across TWO auth realms must share ONE audited session mechanism — not three hand-rolled
// ones. This wraps `@workos-inc/node`; apps NEVER call WorkOS directly.
//
// ⚠️ SERVER-ONLY. This module wraps `@workos-inc/node` and handles sealed-session secrets. It must
// NEVER be imported into browser/client bundles (no "use client" file may import it). The browser
// gets session CLAIMS via server-rendered props / BFF endpoints — never tokens, never this module.
// The FE-shared package is `@app/contracts` (zod-only, browser-safe); this one is not.
//
// STATUS: SEAM SCAFFOLD (ratified 2026-07-01, seam-now/full-defer). The interface below is FROZEN;
// the flow implementations are deferred to PI-2 and currently throw NotImplemented. No login logic
// ships here yet. See ./README.md for the security contract and team/frontend/
// PROPOSAL-fe-auth-bff-seam.md for the full design.

// ── Realm & cookie config ─────────────────────────────────────────────────────────────────────

/** A realm = one WorkOS environment/org + its own sealed-cookie config. Staff vs customer. */
export interface RealmConfig {
  readonly realm: "customer" | "staff";
  /** WORKOS_CLIENT_ID (per realm). */
  readonly clientId: string;
  /** Cookie name — "wos-session" (customer) / "wos-staff" (staff). */
  readonly cookieName: string;
  /** WORKOS_COOKIE_PASSWORD (per realm, 32+ chars, from the secrets manager — NEVER shared
   *  staff↔customer; rotation drains sessions, see README G4). */
  readonly cookiePassword: string;
  /** Per-environment redirect URI, registered in the WorkOS dashboard. */
  readonly redirectUri: string;
  readonly cookieOptions: SessionCookieOptions;
}

export interface SessionCookieOptions {
  /** Always true — no JWT in JS (IDENTITY-SSO §4). */
  readonly httpOnly: true;
  /** Always true. */
  readonly secure: true;
  /** "lax" is fine for redirect SSO; state-changing POSTs still need CSRF defense (README G1). */
  readonly sameSite: "lax";
  readonly path: "/";
  readonly maxAge?: number;
}

// ── Validated session ─────────────────────────────────────────────────────────────────────────

/** The claims the app is allowed to trust. Tokens stay server-side in the sealed cookie. */
export interface AppSession {
  /** WorkOS sub → users.external_subject_id. */
  readonly userId: string;
  /** Active org → tenant_id (pinned; see README §4 org pinning). */
  readonly orgId: string;
  /** owner|admin|member (customer) or staff RBAC role (staff). */
  readonly role: string;
  readonly permissions: readonly string[];
  /** WorkOS sid — correlates back-channel single-logout. */
  readonly sessionId: string;
  /** Elevated-auth timestamp for safety-critical flows (step-up; PI-2). */
  readonly stepUpAt?: number;
  /** Time-boxed, never-silent tenant impersonation (staff; PI-2). */
  readonly impersonation?: ImpersonationClaim;
}

/** Time-boxed impersonation — the affordance (banner + countdown) is @app/ui's; the session-state
 *  claim is this package's. See PROPOSAL §7 ("one feature, two seams"). */
export interface ImpersonationClaim {
  readonly targetTenantId: string;
  readonly expiresAt: number;
  readonly reason: string;
}

/** Account/membership liveness gate run on every validated request — a closed/suspended account or
 *  revoked membership must FAIL CLOSED (blocked-login), not ride a stale sealed cookie. Backed by
 *  the local account status (backend F4 soft-close + F8 provisioning). See README §6. */
export type AccountLivenessCheck = (session: AppSession) => Promise<boolean>;

// ── The flow (FROZEN interface; implementations deferred to PI-2) ──────────────────────────────

/** Build the WorkOS authorization URL. `state` is REQUIRED (CSRF for the OAuth roundtrip, G2). */
export function buildAuthorizationUrl(
  cfg: RealmConfig,
  opts: {
    /** REQUIRED — opaque CSRF token; verify it matches on callback. */
    readonly state: string;
    readonly screenHint?: "sign-up" | "sign-in";
    /** For org-scoped login / org-switch (README §4). */
    readonly organizationId?: string;
  },
): string {
  return notImplemented("buildAuthorizationUrl", cfg, opts);
}

/** Exchange the auth code, validate `state`, and seal the session into an httpOnly cookie value. */
export function handleCallback(
  cfg: RealmConfig,
  params: {
    readonly code: string;
    /** The `state` returned by WorkOS — MUST equal `expectedState` or reject. */
    readonly state: string;
    readonly expectedState: string;
  },
): Promise<{ session: AppSession; sealedCookie: string }> {
  return notImplemented("handleCallback", cfg, params);
}

/** Validate a request — NO network call, just unseal + decode. FAIL-CLOSED: returns null on any
 *  invalid/expired/missing cookie; NEVER throws to a 500. Hold this line in the impl. */
export function readSession(
  cfg: RealmConfig,
  sealedCookie: string | undefined,
): Promise<AppSession | null> {
  return notImplemented("readSession", cfg, sealedCookie);
}

/** Refresh a near-expiry access token and re-seal. Returns null → caller redirects to login
 *  (refresh-token expiry/reuse is a login redirect, NEVER a 500). */
export function refreshSession(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<{ session: AppSession; sealedCookie: string } | null> {
  return notImplemented("refreshSession", cfg, sealedCookie);
}

/** Build the single-logout intent: the WorkOS logout URL + the cleared-cookie value. */
export function buildLogout(
  cfg: RealmConfig,
  sealedCookie: string,
): Promise<{ workosLogoutUrl: string; clearCookie: string }> {
  return notImplemented("buildLogout", cfg, sealedCookie);
}

// ── seam stub helper ───────────────────────────────────────────────────────────────────────────

/** Marks a frozen-interface function whose implementation is deferred to PI-2. Accepts the call's
 *  args so the frozen signatures don't trip noUnusedParameters. Returns `never` → assignable to
 *  every declared return type. */
function notImplemented(fn: string, ..._args: readonly unknown[]): never {
  throw new Error(
    `[@app/fe-auth] ${fn}() is a seam stub — implementation deferred to PI-2. See README.md.`,
  );
}
