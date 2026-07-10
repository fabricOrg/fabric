import { afterEach, describe, expect, it } from "vitest";
import { hasTrustedOrigin, requireTrustedOrigin } from "./origin.js";

/**
 * CSRF origin gate — unit spec (finding A2). This gate protects every admin BFF mutation route
 * (kill-switches, staff, impersonation, tenant members). IDENTITY-SSO §9: SameSite=Lax alone does
 * not cover every cross-site write path, so the origin must match this app's public base URL.
 */

const ORIGINAL = process.env.ADMIN_CONSOLE_BASE_URL;

function req(origin: string | null): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  return new Request("https://ignored.example/api/admin/x", {
    method: "POST",
    headers,
  });
}

describe("hasTrustedOrigin", () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_CONSOLE_BASE_URL;
    else process.env.ADMIN_CONSOLE_BASE_URL = ORIGINAL;
  });

  it("accepts an origin matching ADMIN_CONSOLE_BASE_URL (trailing slash tolerated)", () => {
    process.env.ADMIN_CONSOLE_BASE_URL = "https://admin.fabric.example/";
    expect(hasTrustedOrigin(req("https://admin.fabric.example"))).toBe(true);
  });

  it("rejects a foreign origin", () => {
    process.env.ADMIN_CONSOLE_BASE_URL = "https://admin.fabric.example";
    expect(hasTrustedOrigin(req("https://evil.example"))).toBe(false);
  });

  it("rejects a missing Origin header (no cross-site free pass)", () => {
    process.env.ADMIN_CONSOLE_BASE_URL = "https://admin.fabric.example";
    expect(hasTrustedOrigin(req(null))).toBe(false);
  });

  it("falls back to localhost:3300 when the env var is unset (local dev)", () => {
    delete process.env.ADMIN_CONSOLE_BASE_URL;
    expect(hasTrustedOrigin(req("http://localhost:3300"))).toBe(true);
    expect(hasTrustedOrigin(req("https://admin.fabric.example"))).toBe(false);
  });
});

describe("requireTrustedOrigin", () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_CONSOLE_BASE_URL;
    else process.env.ADMIN_CONSOLE_BASE_URL = ORIGINAL;
  });

  it("returns null (proceed) for a trusted origin", () => {
    process.env.ADMIN_CONSOLE_BASE_URL = "https://admin.fabric.example";
    expect(
      requireTrustedOrigin(req("https://admin.fabric.example")),
    ).toBeNull();
  });

  it("returns a 403 invalid_origin envelope for an untrusted origin", async () => {
    process.env.ADMIN_CONSOLE_BASE_URL = "https://admin.fabric.example";
    const denied = requireTrustedOrigin(req("https://evil.example"));
    expect(denied).not.toBeNull();
    if (!denied) throw new Error("expected a denial response");
    expect(denied.status).toBe(403);
    const body = (await denied.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_origin");
  });
});
