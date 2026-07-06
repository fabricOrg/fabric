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

/** No WORKOS_ORGANIZATION_ID here — staff aren't scoped to one tenant org (unlike the customer realm). */
export function workosAuthConfigured(): boolean {
  return [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WORKOS_COOKIE_PASSWORD",
    "WORKOS_REDIRECT_URI",
    "WORKOS_LOGOUT_REDIRECT_URI",
  ].every((name) => Boolean(process.env[name]));
}

export function staffRealmConfig(): RealmConfig {
  if (!workosAuthConfigured()) {
    throw new Error("The staff WorkOS realm is not fully configured.");
  }
  return {
    realm: "staff",
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
