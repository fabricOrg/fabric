import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  authenticateWithPassword: vi.fn(),
  authenticateWithEmailVerification: vi.fn(),
  authenticateWithMagicAuth: vi.fn(),
  createUser: vi.fn(),
  createMagicAuth: vi.fn(),
  authenticateWithSessionCookie: vi.fn(),
}));

vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    readonly userManagement = {
      authenticateWithPassword: sdk.authenticateWithPassword,
      authenticateWithEmailVerification: sdk.authenticateWithEmailVerification,
      authenticateWithMagicAuth: sdk.authenticateWithMagicAuth,
      createUser: sdk.createUser,
      createMagicAuth: sdk.createMagicAuth,
      authenticateWithSessionCookie: sdk.authenticateWithSessionCookie,
    };
  },
}));

import {
  type RealmConfig,
  signInWithPassword,
  signUpWithPassword,
  verifyEmailCode,
} from "./index.js";

const resolvedSession = {
  userId: "00000000-0000-0000-0000-0000000000a1",
  externalUserId: "user_1",
  email: "person@example.com",
  emailVerified: true,
  name: "Person",
  memberships: [],
  staffRealm: false,
  sessionId: "session_1",
};

const cfg: RealmConfig = {
  realm: "customer",
  apiKey: "sk_test_key",
  clientId: "client_1",
  cookieName: "wos-session",
  cookiePassword: "a-really-long-cookie-password-32ch",
  redirectUri: "https://app.example.com/auth/callback",
  logoutRedirectUri: "https://app.example.com/login",
  cookieOptions: {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  },
  resolveUserSession: async () => resolvedSession,
};

beforeEach(() => {
  for (const fn of Object.values(sdk)) fn.mockReset();
  // A sealed cookie resolves to an authenticated session by default.
  sdk.authenticateWithSessionCookie.mockResolvedValue({
    authenticated: true,
    sessionId: "session_1",
    user: {
      id: "user_1",
      email: "person@example.com",
      name: "Person",
      updatedAt: "2026-07-18T00:00:00.000Z",
      emailVerified: true,
    },
  });
});

describe("signInWithPassword (ADR-0008)", () => {
  it("returns an authenticated session on success", async () => {
    sdk.authenticateWithPassword.mockResolvedValue({
      sealedSession: "sealed-cookie",
    });
    const outcome = await signInWithPassword(cfg, {
      email: "person@example.com",
      password: "hunter2hunter2",
    });
    expect(outcome).toEqual({
      status: "authenticated",
      session: resolvedSession,
      sealedCookie: "sealed-cookie",
    });
  });

  it("surfaces email verification with the pending token", async () => {
    sdk.authenticateWithPassword.mockRejectedValue({
      code: "email_verification_required",
      pendingAuthenticationToken: "pat_123",
      status: 200,
    });
    const outcome = await signInWithPassword(cfg, {
      email: "person@example.com",
      password: "hunter2hunter2",
    });
    expect(outcome).toEqual({
      status: "verification_required",
      pendingAuthenticationToken: "pat_123",
      email: "person@example.com",
    });
  });

  it("falls back to hosted for an MFA challenge", async () => {
    sdk.authenticateWithPassword.mockRejectedValue({
      code: "mfa_challenge",
      status: 200,
    });
    const outcome = await signInWithPassword(cfg, {
      email: "person@example.com",
      password: "hunter2hunter2",
    });
    expect(outcome).toEqual({
      status: "fallback_hosted",
      reason: "mfa_challenge",
    });
  });

  it("reports invalid credentials on a 4xx", async () => {
    sdk.authenticateWithPassword.mockRejectedValue({ status: 401 });
    const outcome = await signInWithPassword(cfg, {
      email: "person@example.com",
      password: "wrong",
    });
    expect(outcome).toEqual({ status: "invalid_credentials" });
  });

  it("reports a transient error on a 5xx (distinct from bad password)", async () => {
    sdk.authenticateWithPassword.mockRejectedValue({ status: 503 });
    const outcome = await signInWithPassword(cfg, {
      email: "person@example.com",
      password: "hunter2hunter2",
    });
    expect(outcome.status).toBe("error");
  });
});

describe("signUpWithPassword (ADR-0008)", () => {
  it("treats a 409 (email exists) as invalid_credentials, not a leak", async () => {
    sdk.createUser.mockRejectedValue({ status: 409 });
    const outcome = await signUpWithPassword(cfg, {
      email: "taken@example.com",
      password: "hunter2hunter2",
    });
    expect(outcome).toEqual({ status: "invalid_credentials" });
    expect(sdk.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("authenticates immediately after creating the user", async () => {
    sdk.createUser.mockResolvedValue({ user: { id: "user_1" } });
    sdk.authenticateWithPassword.mockResolvedValue({
      sealedSession: "sealed-cookie",
    });
    const outcome = await signUpWithPassword(cfg, {
      email: "new@example.com",
      password: "hunter2hunter2",
      firstName: "New",
    });
    expect(outcome.status).toBe("authenticated");
  });
});

describe("verifyEmailCode (ADR-0008)", () => {
  it("seals a session when the code is right", async () => {
    sdk.authenticateWithEmailVerification.mockResolvedValue({
      sealedSession: "sealed-cookie",
    });
    const outcome = await verifyEmailCode(cfg, {
      code: "123456",
      pendingAuthenticationToken: "pat_123",
    });
    expect(outcome.status).toBe("authenticated");
  });

  it("reports invalid_credentials on a wrong code (4xx)", async () => {
    sdk.authenticateWithEmailVerification.mockRejectedValue({ status: 400 });
    const outcome = await verifyEmailCode(cfg, {
      code: "000000",
      pendingAuthenticationToken: "pat_123",
    });
    expect(outcome).toEqual({ status: "invalid_credentials" });
  });
});
