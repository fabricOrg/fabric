import "server-only";

import {
  type AppSession,
  type DevelopmentSessionConfig,
  type ImpersonationClaim,
  type RealmConfig,
  readDevelopmentSession,
  readImpersonation,
  readSession,
  sealDevelopmentSession,
} from "@app/fe-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffSession } from "./staff-identity";

export const DEVELOPMENT_COOKIE = "fabric-admin-development-session";
export const WORKOS_COOKIE = "wos-admin-session";
export const OAUTH_STATE_COOKIE = "fabric-admin-oauth-state";

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

/** This app's public origin — cloud sets ADMIN_CONSOLE_BASE_URL, dev falls back to the port. The
 * WorkOS redirect/logout URIs derive from it (no per-app WORKOS_REDIRECT_URI in the shared env). */
function appBaseUrl(): string {
  return (
    process.env.ADMIN_CONSOLE_BASE_URL?.trim() || "http://localhost:3300"
  ).replace(/\/$/, "");
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

export function configuredDevelopmentSession(): AppSession {
  return {
    userId: "development-staff",
    orgId: "",
    role: "staff",
    permissions: ["staff:*"],
    sessionId: "development-staff-session",
  };
}

export function issueDevelopmentSession(): string {
  return sealDevelopmentSession(
    developmentAuthConfig(),
    configuredDevelopmentSession(),
  );
}

export async function readAdminSession(): Promise<AppSession | null> {
  const store = await cookies();
  if (workosAuthConfigured()) {
    const workosCookie = store.get(WORKOS_COOKIE)?.value;
    if (workosCookie) {
      const session = await readSession(staffRealmConfig(), workosCookie);
      if (session) return session;
    }
  }
  return readDevelopmentSession(
    developmentAuthConfig(),
    store.get(DEVELOPMENT_COOKIE)?.value,
  );
}

export async function requireAdminSession(): Promise<AppSession> {
  const store = await cookies();
  const session = await readAdminSession();
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
