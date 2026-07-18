import "server-only";

import {
  type AppSession,
  type RealmConfig,
  readUserSession,
  refreshUserSession,
  type UserSession,
  type WorkspaceMembershipClaim,
} from "@app/fe-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveUserSessionV2 } from "./identity-client";
import { selectWorkspace, WORKSPACE_COOKIE } from "./workspace-cookie";

export const WORKOS_COOKIE = "wos-session";
export const OAUTH_STATE_COOKIE = "fabric-oauth-state";
/**
 * Short-lived flash cookie carrying a sign-in NOTICE ("access_denied" | "signed_out") across the
 * WorkOS logout hop. A `?error=` query can't survive that external round-trip (WorkOS controls the
 * return URL), so the reason rides a same-site cookie the /login page reads on the way back.
 */
export const AUTH_NOTICE_COOKIE = "fabric-auth-notice";

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

/**
 * This app's own public origin. Cloud sets DASHBOARD_BASE_URL (the deployed URL); locally it falls
 * back to the dev port — so the WorkOS redirect/logout URIs are DERIVED per-app from one base,
 * instead of each app needing its own WORKOS_REDIRECT_URI in a shared env. Trailing slash trimmed.
 */
function appBaseUrl(): string {
  return (
    process.env.DASHBOARD_BASE_URL?.trim() || "http://localhost:3100"
  ).replace(/\/$/, "");
}

export function workosAuthConfigured(): boolean {
  // WORKOS_ORGANIZATION_ID is no longer required: logins are unpinned (ADR-0002) and the org is
  // resolved per identity — existing membership or self-serve sandbox provisioning.
  return [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WORKOS_COOKIE_PASSWORD",
    "BFF_INTERNAL_TOKEN",
  ].every((name) => Boolean(process.env[name]));
}

export function customerRealmConfig(): RealmConfig {
  if (!workosAuthConfigured()) {
    throw new Error("The customer WorkOS realm is not fully configured.");
  }
  const base = appBaseUrl();
  return {
    realm: "customer",
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
    // ADR-0007: the customer realm is user-level only — the org-scoped resolver is a dead end
    // (denies everything) and disappears when RealmConfig drops it with the v1 path.
    resolveSession: async () => null,
    resolveUserSession: resolveUserSessionV2,
  };
}

/** ADR-0007: the user-level session — WHO is signed in plus every workspace they can enter. */
export async function readDashboardUserSession(): Promise<UserSession | null> {
  if (!workosAuthConfigured()) return null;
  const store = await cookies();
  const workosCookie = store.get(WORKOS_COOKIE)?.value;
  if (!workosCookie) return null;
  return readUserSession(customerRealmConfig(), workosCookie);
}

/**
 * The ACTIVE workspace session — the user-level session narrowed to the workspace the selector
 * cookie names, revalidated against a fresh membership list on THIS request (fail closed). Kept in
 * the legacy AppSession shape so the BFF routes' permission/tenant plumbing is unchanged: `orgId`
 * is now simply the selected tenant id.
 */
export async function readDashboardSession(): Promise<AppSession | null> {
  const user = await readDashboardUserSession();
  if (!user) return null;
  const store = await cookies();
  const membership = selectWorkspace(user, store.get(WORKSPACE_COOKIE)?.value);
  if (!membership) return null;
  return toWorkspaceSession(user, membership);
}

/**
 * Refresh an expired WorkOS session from a route handler (BFF), where cookies are writable. The
 * access token in the sealed cookie is short-lived; on expiry readSession() fails closed and BFF
 * fetches would 401. Here we swap the refresh token for a fresh access token, re-seal the cookie,
 * and return the session — so a `fetch` to a BFF route recovers silently instead of dead-ending the
 * user (page navigations already refresh via requireDashboardSession → /auth/refresh).
 * Returns null if there's no cookie or the refresh token is spent/revoked (→ genuine re-login).
 */
export async function refreshDashboardSession(): Promise<AppSession | null> {
  const user = await refreshDashboardUserSession();
  if (!user) return null;
  const store = await cookies();
  const membership = selectWorkspace(user, store.get(WORKSPACE_COOKIE)?.value);
  if (!membership) return null;
  return toWorkspaceSession(user, membership);
}

/** User-level variant of the silent refresh — same cookie rotation semantics. */
export async function refreshDashboardUserSession(): Promise<UserSession | null> {
  if (!workosAuthConfigured()) return null;
  const store = await cookies();
  const sealed = store.get(WORKOS_COOKIE)?.value;
  if (!sealed) return null;
  const refreshed = await refreshUserSession(customerRealmConfig(), sealed);
  if (!refreshed) return null;
  try {
    store.set(WORKOS_COOKIE, refreshed.sealedCookie, sessionCookieOptions());
  } catch {
    // cookies() is read-only during a Server Component render; the refreshed session is still valid
    // for THIS request, and the next request re-refreshes. Only route handlers persist the new cookie.
  }
  return refreshed.session;
}

/**
 * Page-level gate. Signed-in users without a usable workspace are routed to the surface that fixes
 * it: no memberships → onboarding (create one), several without a selection → the picker.
 */
export async function requireDashboardSession(): Promise<AppSession> {
  const store = await cookies();
  const user = await readDashboardUserSession();
  if (!user) {
    if (workosAuthConfigured() && store.has(WORKOS_COOKIE)) {
      // Carry the current path through the refresh hop so a reload returns here, not the home route.
      const pathname = (await headers()).get("x-pathname");
      const returnTo = pathname?.startsWith("/") ? pathname : "/";
      redirect(`/auth/refresh?return_to=${encodeURIComponent(returnTo)}`);
    }
    redirect("/login");
  }
  const membership = selectWorkspace(user, store.get(WORKSPACE_COOKIE)?.value);
  if (!membership) {
    redirect(user.memberships.length === 0 ? "/onboarding" : "/workspaces");
  }
  return toWorkspaceSession(user, membership);
}

/** Page-level gate for surfaces that need a signed-in USER but no workspace (onboarding/picker). */
export async function requireDashboardUserSession(): Promise<UserSession> {
  const store = await cookies();
  const user = await readDashboardUserSession();
  if (user) return user;
  if (workosAuthConfigured() && store.has(WORKOS_COOKIE)) {
    const pathname = (await headers()).get("x-pathname");
    const returnTo = pathname?.startsWith("/") ? pathname : "/";
    redirect(`/auth/refresh?return_to=${encodeURIComponent(returnTo)}`);
  }
  redirect("/login");
}

function toWorkspaceSession(
  user: UserSession,
  membership: WorkspaceMembershipClaim,
): AppSession {
  return {
    userId: user.userId,
    orgId: membership.tenantId,
    role: membership.role,
    permissions: membership.permissions,
    sessionId: user.sessionId,
    email: user.email,
    name: user.name ?? undefined,
    plan: membership.plan,
  };
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
