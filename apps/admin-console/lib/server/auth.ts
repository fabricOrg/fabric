import "server-only";

import {
  type AppSession,
  type ImpersonationClaim,
  type RealmConfig,
  readImpersonation,
  readSession,
  refreshSession,
} from "@app/fe-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffSession } from "./staff-identity";

export const WORKOS_COOKIE = "wos-admin-session";
export const OAUTH_STATE_COOKIE = "fabric-admin-oauth-state";
/**
 * Short-lived flash cookie carrying a sign-in NOTICE ("access_denied" | "signed_out") across the
 * WorkOS logout hop. A `?error=` query can't survive that external round-trip, so the reason rides a
 * same-site cookie the /login page reads on the way back.
 */
export const AUTH_NOTICE_COOKIE = "fabric-admin-auth-notice";

/** Cookie options for the flash notice — same-site so it survives the WorkOS logout redirect. */
export function noticeCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60,
  };
}

/** This app's public origin — cloud sets ADMIN_CONSOLE_BASE_URL, dev falls back to the port. The
 * WorkOS redirect/logout URIs derive from it (no per-app WORKOS_REDIRECT_URI in the shared env). */
function appBaseUrl(): string {
  return (
    process.env.ADMIN_CONSOLE_BASE_URL?.trim() || "http://localhost:3300"
  ).replace(/\/$/, "");
}

/**
 * Absolute redirect target on this app's PUBLIC origin. Behind API Gateway + VPC Link the container
 * sees its own internal host (0.0.0.0:3000) as `request.url`, so auth redirects built from it send
 * users to an unreachable URL. Always resolve against the public base (ADMIN_CONSOLE_BASE_URL in
 * cloud, the dev port locally). `request` is accepted for call-site symmetry but not needed.
 */
export function redirectUrl(path: string, _request?: { url: string }): URL {
  return new URL(path, appBaseUrl());
}

/** No WORKOS_ORGANIZATION_ID (staff aren't org-scoped); BFF token is needed for the staff-session call. */
export function workosAuthConfigured(): boolean {
  return [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WORKOS_COOKIE_PASSWORD",
    "BFF_INTERNAL_TOKEN",
  ].every((name) => Boolean(process.env[name]));
}

export function staffRealmConfig(): RealmConfig {
  if (!workosAuthConfigured()) {
    throw new Error("The staff WorkOS realm is not fully configured.");
  }
  const base = appBaseUrl();
  return {
    realm: "staff",
    apiKey: process.env.WORKOS_API_KEY ?? "",
    clientId: process.env.WORKOS_CLIENT_ID ?? "",
    cookieName: WORKOS_COOKIE,
    cookiePassword: process.env.WORKOS_COOKIE_PASSWORD ?? "",
    redirectUri: `${base}/auth/callback`,
    logoutRedirectUri: `${base}/login`,
    cookieOptions: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    },
    resolveSession: resolveStaffSession,
  };
}

export async function readAdminSession(): Promise<AppSession | null> {
  if (!workosAuthConfigured()) return null;
  const store = await cookies();
  const workosCookie = store.get(WORKOS_COOKIE)?.value;
  if (!workosCookie) return null;
  return readSession(staffRealmConfig(), workosCookie);
}

/**
 * Refresh an expired WorkOS session from a route handler (BFF), where cookies are writable. The
 * access token in the sealed cookie is short-lived; on expiry readAdminSession() fails closed and a
 * BFF mutation would 401 ("Staff sign-in required") even though the user is still signed in. Here we
 * swap the refresh token for a fresh access token, re-seal the cookie, and return the session.
 * Returns null if there's no cookie or the refresh token is spent/revoked (→ genuine re-login).
 */
export async function refreshAdminSession(): Promise<AppSession | null> {
  if (!workosAuthConfigured()) return null;
  const store = await cookies();
  const sealed = store.get(WORKOS_COOKIE)?.value;
  if (!sealed) return null;
  const refreshed = await refreshSession(staffRealmConfig(), sealed);
  if (!refreshed) return null;
  try {
    store.set(WORKOS_COOKIE, refreshed.sealedCookie, sessionCookieOptions());
  } catch {
    // cookies() is read-only during a Server Component render; the refreshed session is still valid
    // for THIS request, and the next request re-refreshes. Only route handlers persist the cookie.
  }
  return refreshed.session;
}

/**
 * Session for BFF route handlers: read it, transparently refreshing an expired WorkOS access token
 * so an in-page action (invite / remove / role-change) doesn't 401 just because the short-lived
 * token lapsed since the page loaded. Page/Server-Component reads use requireAdminSession (which
 * redirects to /auth/refresh instead).
 */
export async function readAdminSessionWithRefresh(): Promise<AppSession | null> {
  return (await readAdminSession()) ?? (await refreshAdminSession());
}

export async function requireAdminSession(): Promise<AppSession> {
  const store = await cookies();
  const session = await readAdminSession();
  if (session) return session;
  if (workosAuthConfigured() && store.has(WORKOS_COOKIE)) {
    // Carry the current path through the refresh hop so a reload returns here, not the home route.
    const pathname = (await headers()).get("x-pathname");
    const returnTo = pathname?.startsWith("/") ? pathname : "/";
    redirect(`/auth/refresh?return_to=${encodeURIComponent(returnTo)}`);
  }
  redirect("/login");
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  };
}

export const IMPERSONATION_COOKIE = "fabric-admin-impersonation";
/** Max impersonation window; the sealed claim also carries its own expiry (defense in depth). */
export const IMPERSONATION_WINDOW_SECONDS = 15 * 60;

/** The secret that seals the impersonation claim cookie — reuse the WorkOS cookie password (≥32). */
export function impersonationCookiePassword(): string {
  return process.env.WORKOS_COOKIE_PASSWORD ?? "";
}

/** Read the active impersonation claim (or null if none / expired / tampered). */
export async function readImpersonationClaim(): Promise<ImpersonationClaim | null> {
  const password = impersonationCookiePassword();
  if (password.length < 32) return null;
  const store = await cookies();
  return readImpersonation(password, store.get(IMPERSONATION_COOKIE)?.value);
}
