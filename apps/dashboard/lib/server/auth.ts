import "server-only";

import {
  type AppSession,
  type DevelopmentSessionConfig,
  type RealmConfig,
  readDevelopmentSession,
  readSession,
  sealDevelopmentSession,
} from "@app/fe-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveWorkOSSession } from "./identity-client";

export const DEVELOPMENT_COOKIE = "fabric-development-session";
export const WORKOS_COOKIE = "wos-session";
export const OAUTH_STATE_COOKIE = "fabric-oauth-state";

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

export function workosAuthConfigured(): boolean {
  return [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WORKOS_COOKIE_PASSWORD",
    "WORKOS_REDIRECT_URI",
    "WORKOS_LOGOUT_REDIRECT_URI",
    "WORKOS_ORGANIZATION_ID",
    "BFF_INTERNAL_TOKEN",
  ].every((name) => Boolean(process.env[name]));
}

export function customerRealmConfig(): RealmConfig {
  if (!workosAuthConfigured()) {
    throw new Error("The customer WorkOS realm is not fully configured.");
  }
  return {
    realm: "customer",
    apiKey: process.env.WORKOS_API_KEY ?? "",
    clientId: process.env.WORKOS_CLIENT_ID ?? "",
    cookieName: WORKOS_COOKIE,
    cookiePassword: process.env.WORKOS_COOKIE_PASSWORD ?? "",
    redirectUri: process.env.WORKOS_REDIRECT_URI ?? "",
    logoutRedirectUri: process.env.WORKOS_LOGOUT_REDIRECT_URI ?? "",
    cookieOptions: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    },
    resolveSession: resolveWorkOSSession,
  };
}

export function configuredDevelopmentSession(): AppSession {
  const orgId = process.env.DEV_TENANT_ID;
  if (!orgId) throw new Error("DEV_TENANT_ID is required.");
  return {
    userId: "development-user",
    orgId,
    role: "owner",
    permissions: ["sms:send", "sms:read", "wallet:read"],
    sessionId: "development-session",
  };
}

export function issueDevelopmentSession(): string {
  return sealDevelopmentSession(
    developmentAuthConfig(),
    configuredDevelopmentSession(),
  );
}

export async function readDashboardSession(): Promise<AppSession | null> {
  const store = await cookies();
  if (workosAuthConfigured()) {
    const workosCookie = store.get(WORKOS_COOKIE)?.value;
    if (workosCookie) {
      const session = await readSession(customerRealmConfig(), workosCookie);
      if (session) return session;
    }
  }
  return readDevelopmentSession(
    developmentAuthConfig(),
    store.get(DEVELOPMENT_COOKIE)?.value,
  );
}

export async function requireDashboardSession(): Promise<AppSession> {
  const store = await cookies();
  const session = await readDashboardSession();
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

/**
 * Absolute redirect target on the app's PUBLIC origin. Behind API Gateway + VPC Link the container
 * sees the internal host (ip-…:3000) as `request.url`, so redirects built from it send users to an
 * unreachable URL. Prefer DASHBOARD_BASE_URL (the public domain); fall back to request.url locally
 * where it isn't set.
 */
export function redirectUrl(path: string, request: { url: string }): URL {
  const base = process.env.DASHBOARD_BASE_URL;
  return base ? new URL(path, base) : new URL(path, request.url);
}
