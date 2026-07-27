import type { UserSession, WorkspaceMembershipClaim } from "@app/fe-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKOS_COOKIE } from "./auth";
import { authenticatedResponse } from "./credential-landing";
import { WORKSPACE_COOKIE } from "./workspace-cookie";

/**
 * Guards the staff/customer landing split. Staff invitations are issued by the DEFAULT WorkOS
 * application (the customer dashboard) and `sendInvitation` carries no per-invite redirect, so an
 * operator's accept link lands here. If this branch regresses, an operator is dropped into the
 * onboarding wizard and creates a stray customer workspace — the bug this exists to prevent.
 */
const ORIGINAL_ADMIN_URL = process.env.ADMIN_CONSOLE_BASE_URL;
const ORIGINAL_COOKIE_PASSWORD = process.env.WORKOS_COOKIE_PASSWORD;

const membership: WorkspaceMembershipClaim = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  workspaceName: "Acme",
  workspaceSlug: "acme",
  role: "owner",
  developerAccess: false,
  permissions: [],
  plan: "growth",
};

function session(overrides: Partial<UserSession> = {}): UserSession {
  return {
    userId: "20000000-0000-4000-8000-000000000001",
    externalUserId: "user_1",
    email: "operator@example.com",
    emailVerified: true,
    name: "Operator",
    memberships: [],
    staffRealm: false,
    sessionId: "session_1",
    ...overrides,
  };
}

/** Cookie names the response DELETES appear as a max-age-0 set-cookie, not as an absence. */
function deletedCookies(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .filter((cookie) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cookie))
    .map((cookie) => cookie.slice(0, cookie.indexOf("=")));
}

beforeEach(() => {
  process.env.WORKOS_COOKIE_PASSWORD = "a-really-long-cookie-password-32ch";
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (ORIGINAL_ADMIN_URL === undefined)
    delete process.env.ADMIN_CONSOLE_BASE_URL;
  else process.env.ADMIN_CONSOLE_BASE_URL = ORIGINAL_ADMIN_URL;
  if (ORIGINAL_COOKIE_PASSWORD === undefined) {
    delete process.env.WORKOS_COOKIE_PASSWORD;
  } else {
    process.env.WORKOS_COOKIE_PASSWORD = ORIGINAL_COOKIE_PASSWORD;
  }
});

describe("authenticatedResponse — staff landing", () => {
  it("sends a staff-only identity to the admin console, not onboarding", async () => {
    process.env.ADMIN_CONSOLE_BASE_URL = "https://admin.fabric.example";
    const response = authenticatedResponse(
      session({ staffRealm: true }),
      "sealed",
    );
    await expect(response.json()).resolves.toMatchObject({
      next: "https://admin.fabric.example/signin",
    });
  });

  it("mints no dashboard session and clears one left by another identity", () => {
    process.env.ADMIN_CONSOLE_BASE_URL = "https://admin.fabric.example";
    const response = authenticatedResponse(
      session({ staffRealm: true }),
      "sealed",
    );
    // A surviving session would skip the fallback notice AND drop the operator into whichever
    // workspace the previous user had selected.
    expect(deletedCookies(response)).toEqual(
      expect.arrayContaining([WORKOS_COOKIE, WORKSPACE_COOKIE]),
    );
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith(`${WORKOS_COOKIE}=sealed`)),
    ).toBe(false);
  });

  it("falls back to an in-app notice when the console URL is unknown", async () => {
    delete process.env.ADMIN_CONSOLE_BASE_URL;
    // stubEnv, not a plain assignment: NODE_ENV is typed read-only, and this restores itself.
    vi.stubEnv("NODE_ENV", "production");
    const response = authenticatedResponse(
      session({ staffRealm: true }),
      "sealed",
    );
    await expect(response.json()).resolves.toMatchObject({
      next: "/signin?error=staff_account",
    });
  });

  it("lets a staff member who also holds a membership use the dashboard", async () => {
    process.env.ADMIN_CONSOLE_BASE_URL = "https://admin.fabric.example";
    const response = authenticatedResponse(
      session({ staffRealm: true, memberships: [membership] }),
      "sealed",
    );
    await expect(response.json()).resolves.toMatchObject({ next: "/" });
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith(`${WORKOS_COOKIE}=sealed`)),
    ).toBe(true);
  });

  it("still routes a non-staff newcomer to onboarding", async () => {
    const response = authenticatedResponse(session(), "sealed");
    await expect(response.json()).resolves.toMatchObject({
      next: "/onboarding",
    });
  });
});
