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
import { resolveDeveloperSession } from "./developer-identity";

export const DEVELOPMENT_COOKIE = "fabric-dev-development-session";
export const WORKOS_COOKIE = "wos-dev-session";
export const OAUTH_STATE_COOKIE = "fabric-dev-oauth-state";

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

/** No WORKOS_ORGANIZATION_ID here — this is a coarse allowlist gate, not tenant-scoped (yet). */
export function workosAuthConfigured(): boolean {
  return [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WORKOS_COOKIE_PASSWORD",
    "WORKOS_REDIRECT_URI",
    "WORKOS_LOGOUT_REDIRECT_URI",
  ].every((name) => Boolean(process.env[name]));
}

export function developerRealmConfig(): RealmConfig {
  if (!workosAuthConfigured()) {
    throw new Error("The developer WorkOS realm is not fully configured.");
  }
  return {
    realm: "developer",
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
