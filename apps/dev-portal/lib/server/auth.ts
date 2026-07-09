import "server-only";

import {
  type AppSession,
  type DevelopmentSessionConfig,
  type RealmConfig,
  readDevelopmentSession,
  readSession,
  refreshSession,
  sealDevelopmentSession,
} from "@app/fe-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveDeveloperSession } from "./developer-identity";

export const DEVELOPMENT_COOKIE = "fabric-dev-development-session";
export const WORKOS_COOKIE = "wos-dev-session";
export const OAUTH_STATE_COOKIE = "fabric-dev-oauth-state";
/**
 * Short-lived flash cookie carrying a sign-in NOTICE ("access_denied" | "signed_out") across the
 * WorkOS logout hop. A `?error=` query can't survive that external round-trip, so the reason rides a
 * same-site cookie the /login page reads on the way back.
 */
export const AUTH_NOTICE_COOKIE = "fabric-dev-auth-notice";

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

export function developmentAuthConfig(): DevelopmentSessionConfig {
  const runtime =
    process.env.NODE_ENV === "production"
      ? "production"
      : process.env.NODE_ENV === "test"
        ? "test"
        : "development";
  return {
    enabled: process.env.DEV_AUTH_ENABLED === "true",
    runtime,
    cookiePassword: process.env.DEV_SESSION_PASSWORD ?? "",
  };
}

/** This app's public origin — cloud sets DEV_PORTAL_BASE_URL, dev falls back to the port. The WorkOS
 * redirect/logout URIs derive from it (no per-app WORKOS_REDIRECT_URI in the shared env). */
function appBaseUrl(): string {
  return (
    process.env.DEV_PORTAL_BASE_URL?.trim() || "http://localhost:3200"
  ).replace(/\/$/, "");
}

/**
 * Absolute redirect target on this app's PUBLIC origin. Behind API Gateway + VPC Link the container
 * sees its own internal host (0.0.0.0:3000) as `request.url`, so auth redirects built from it send
 * users to an unreachable URL. Always resolve against the public base (DEV_PORTAL_BASE_URL in cloud,
 * the dev port locally). `request` is accepted for call-site symmetry but not needed.
 */
export function redirectUrl(path: string, _request?: { url: string }): URL {
  return new URL(path, appBaseUrl());
}

/** Org-scoped like the dashboard — a developer is a tenant member; BFF token gates the session call. */
export function workosAuthConfigured(): boolean {
  return [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WORKOS_COOKIE_PASSWORD",
    "WORKOS_ORGANIZATION_ID",
    "BFF_INTERNAL_TOKEN",
  ].every((name) => Boolean(process.env[name]));
}

export function developerRealmConfig(): RealmConfig {
  if (!workosAuthConfigured()) {
    throw new Error("The developer WorkOS realm is not fully configured.");
  }
  const base = appBaseUrl();
  return {
    realm: "developer",
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
    resolveSession: resolveDeveloperSession,
  };
}

export function configuredDevelopmentSession(): AppSession {
  return {
    userId: "development-developer",
    orgId: "",
    role: "developer",
    permissions: ["developer:*"],
    sessionId: "development-developer-session",
  };
}

export function issueDevelopmentSession(): string {
  return sealDevelopmentSession(
    developmentAuthConfig(),
    configuredDevelopmentSession(),
  );
}

export async function readDeveloperSession(): Promise<AppSession | null> {
  const store = await cookies();
  if (workosAuthConfigured()) {
    const workosCookie = store.get(WORKOS_COOKIE)?.value;
    if (workosCookie) {
      const session = await readSession(developerRealmConfig(), workosCookie);
      if (session) return session;
    }
  }
  return readDevelopmentSession(
    developmentAuthConfig(),
    store.get(DEVELOPMENT_COOKIE)?.value,
  );
}

/**
 * Refresh an expired WorkOS session from a route handler (BFF), where cookies are writable.
 * Mirrors the dashboard/admin helpers (G2 hardening): without it, the first dev-portal BFF data
 * route would reach for plain readDeveloperSession() and reintroduce the it-401s-after-token-
 * expiry bug class (#94). Returns null when there's no cookie or the refresh is terminal.
 */
export async function refreshDeveloperSession(): Promise<AppSession | null> {
  if (!workosAuthConfigured()) return null;
  const store = await cookies();
  const sealed = store.get(WORKOS_COOKIE)?.value;
  if (!sealed) return null;
  const refreshed = await refreshSession(developerRealmConfig(), sealed);
  if (!refreshed) return null;
  try {
    store.set(WORKOS_COOKIE, refreshed.sealedCookie, sessionCookieOptions());
  } catch {
    // cookies() is read-only during a Server Component render; the refreshed session is still
    // valid for THIS request. Only route handlers persist the cookie.
  }
  return refreshed.session;
}

/**
 * Session for BFF route handlers: read, transparently refreshing an expired access token.
 * Pages/Server Components use requireDeveloperSession (redirects to /auth/refresh) instead.
 * A plain readDeveloperSession() in a mutation route is a bug (CLAUDE.md §4).
 */
export async function readDeveloperSessionWithRefresh(): Promise<AppSession | null> {
  return (await readDeveloperSession()) ?? (await refreshDeveloperSession());
}

export async function requireDeveloperSession(): Promise<AppSession> {
  const store = await cookies();
  const session = await readDeveloperSession();
  if (session) return session;
  if (workosAuthConfigured() && store.has(WORKOS_COOKIE)) {
    redirect("/auth/refresh");
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
