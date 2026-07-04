import "server-only";

import {
  type AppSession,
  type DevelopmentSessionConfig,
  readDevelopmentSession,
  sealDevelopmentSession,
} from "@app/fe-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const DEVELOPMENT_COOKIE = "fabric-development-session";

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
  return readDevelopmentSession(
    developmentAuthConfig(),
    store.get(DEVELOPMENT_COOKIE)?.value,
  );
}

export async function requireDashboardSession(): Promise<AppSession> {
  const session = await readDashboardSession();
  if (!session) redirect("/login");
  return session;
}
