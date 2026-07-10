import { createHmac } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { TenantTokenService } from "./tenant-token.service.js";

function signWith(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

const TENANT = "11111111-2222-4333-8444-555555555555";

function service(secret: string | undefined): TenantTokenService {
  const config = {
    get: (key: string) => (key === "TENANT_TOKEN_SECRET" ? secret : undefined),
  } as ConfigService;
  return new TenantTokenService(config);
}

describe("TenantTokenService", () => {
  it("round-trips: a minted token verifies to its tenant", () => {
    const svc = service("test-secret");
    const { token, expiresIn } = svc.mint(TENANT);
    expect(token.startsWith("bfft_")).toBe(true);
    expect(expiresIn).toBeGreaterThan(0);
    const verified = svc.verify(token);
    expect(verified?.tenantId).toBe(TENANT);
    expect(verified?.keyId).toBe(`bfft_${TENANT.slice(0, 12)}`);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const svc = service("test-secret");
    const { token } = svc.mint(TENANT);
    const [prefixAndBody, sig] = token.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({
        t: "99999999-9999-4999-8999-999999999999",
        exp: 9999999999,
      }),
    ).toString("base64url");
    expect(svc.verify(`bfft_${forgedBody}.${sig}`)).toBeNull();
    expect(prefixAndBody).toBeDefined();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = service("secret-a").mint(TENANT);
    expect(service("secret-b").verify(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const svc = service("test-secret");
    const expired = Buffer.from(
      JSON.stringify({ t: TENANT, exp: Math.floor(Date.now() / 1000) - 1 }),
    ).toString("base64url");
    const sig = signWith("test-secret", expired);
    expect(svc.verify(`bfft_${expired}.${sig}`)).toBeNull();
  });

  it("rejects malformed shapes (wrong prefix, missing segments, junk payload)", () => {
    const svc = service("test-secret");
    expect(svc.verify("sk_test_notatoken")).toBeNull();
    expect(svc.verify("bfft_onlyonesegment")).toBeNull();
    expect(svc.verify("bfft_a.b.c")).toBeNull();
    const junk = Buffer.from("not json").toString("base64url");
    const sig = signWith("test-secret", junk);
    expect(svc.verify(`bfft_${junk}.${sig}`)).toBeNull();
  });

  it("fails closed with no secret configured: cannot mint, verifies nothing", () => {
    const svc = service(undefined);
    expect(() => svc.mint(TENANT)).toThrow(/TENANT_TOKEN_SECRET/);
    const { token } = service("test-secret").mint(TENANT);
    expect(svc.verify(token)).toBeNull();
  });
});
