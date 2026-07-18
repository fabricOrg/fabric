import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserSession, WorkspaceMembershipClaim } from "@app/fe-auth";

/**
 * ADR-0007 workspace selector — which workspace this browser last chose. A SELECTOR, not an
 * authority: it is only ever honored when the freshly resolved user session actually contains a
 * membership for that tenant, so a forged/stale value degrades to "no selection". Signed anyway
 * (HMAC over the tenant id) as defense in depth, and kept separate from the WorkOS session cookie
 * so switching workspaces never touches authentication.
 */
export const WORKSPACE_COOKIE = "fabric-workspace";

function workspaceSecret(): string {
  const secret = process.env.WORKOS_COOKIE_PASSWORD ?? "";
  if (secret.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters.");
  }
  return secret;
}

function signature(tenantId: string): string {
  return createHmac("sha256", workspaceSecret())
    .update(`workspace:${tenantId}`)
    .digest("base64url");
}

export function sealWorkspaceSelector(tenantId: string): string {
  return `${tenantId}.${signature(tenantId)}`;
}

export function readWorkspaceSelector(
  value: string | undefined,
): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const tenantId = value.slice(0, separator);
  const presented = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(signature(tenantId));
  if (
    presented.length !== expected.length ||
    !timingSafeEqual(presented, expected)
  ) {
    return null;
  }
  return tenantId;
}

/**
 * Resolve the ACTIVE membership for this request: the selector's workspace when the session still
 * holds a membership there (revalidated every request — fail closed), else an unambiguous single
 * membership. Several memberships without a valid selector → null → the in-app picker decides.
 */
export function selectWorkspace(
  session: UserSession,
  selectorCookie: string | undefined,
): WorkspaceMembershipClaim | null {
  const selected = readWorkspaceSelector(selectorCookie);
  if (selected) {
    const match = session.memberships.find(
      (membership) => membership.tenantId === selected,
    );
    if (match) return match;
  }
  if (session.memberships.length === 1) return session.memberships[0] ?? null;
  return null;
}

/** Long-lived selector cookie — safe because it grants nothing by itself (see above). */
export function workspaceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 90 * 24 * 60 * 60,
  };
}
