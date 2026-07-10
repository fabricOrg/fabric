// ============================================================================================
// L2 increment 4b — ApiKeyService.resolve + ApiKeyGuard END-TO-END against a real migrated DB.
// tier: test:integration. Complementary to adams' packages/db api-key-isolation spec (that gate
// proves the withApiKeyLookup RLS layer; THIS proves the service+guard wiring on top of it):
// resolve(active) → {tenantId, scopes}; revoked/unknown/malformed → null; guard → 401 F8.3 auth_error.
//
// Env (prod-faithful owner, 366cabd): DATABASE_URL_SUPER = app_owner (cross-tenant seeds, bypass RLS);
// DATABASE_URL_APP = app_runtime (RLS-enforced — what the service actually connects as). DB must be
// migrated AS app_migrator (DATABASE_URL_OWNER) first — same harness as the other integration specs.
// ============================================================================================

import type { ApiErrorEnvelope } from "@app/contracts";
import { createAppDb } from "@app/db";
import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { hashApiKey } from "./api-key.crypto.js";
import { ApiKeyGuard } from "./api-key.guard.js";
import { ApiKeyService } from "./api-keys.service.js";
import { TenantTokenService } from "./tenant-token.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "api-key integration needs DATABASE_URL_SUPER + DATABASE_URL_APP (a fresh DB migrated as app_migrator)",
  );
}

const owner = postgres(SUPER_URL, { max: 2 }); // superuser: seeds cross-tenant (bypasses FORCE RLS)
const db = createAppDb(APP_URL, { max: 1 }); // app_runtime: RLS-enforced, the real service connection
const svc = new ApiKeyService(db);
// Real RateLimitService with no REDIS_QUEUE_URL → limiting disabled (pass-through).
const guard = new ApiKeyGuard(
  svc,
  new RateLimitService({ get: () => undefined } as unknown as ConfigService),
  // No TENANT_TOKEN_SECRET here — bfft_ tokens are rejected (fail closed); key paths unaffected.
  new TenantTokenService({ get: () => undefined } as unknown as ConfigService),
);

const TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTIVE_RAW = `sk_test_${"c".repeat(32)}`;
const REVOKED_RAW = `sk_test_${"d".repeat(32)}`;
const UNKNOWN_RAW = `sk_test_${"e".repeat(32)}`;

// Fake ExecutionContext with an Authorization header (mirrors the guard unit spec).
function ctxWithBearer(raw: string): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string>; tenant?: unknown };
} {
  const req = { headers: { authorization: `Bearer ${raw}` } } as {
    headers: Record<string, string>;
    tenant?: unknown;
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

beforeAll(async () => {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, 'Tenant C', 'tenant-c') ON CONFLICT (id) DO NOTHING",
    [TENANT],
  );
  // key_hash uses the SAME hashApiKey the service computes → the possession lookup matches.
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, 'sk_test_actv', $2, 'test', '["sms:send"]'::jsonb, 'active'),
            ($1, 'sk_test_revk', $3, 'test', '[]'::jsonb, 'revoked')`,
    [TENANT, hashApiKey(ACTIVE_RAW), hashApiKey(REVOKED_RAW)],
  );
});

afterAll(async () => {
  await owner.unsafe("DELETE FROM api_keys WHERE tenant_id = $1", [TENANT]);
  await owner.unsafe("DELETE FROM accounts WHERE id = $1", [TENANT]);
  await owner.end();
  await db.end();
});

describe("ApiKeyService.resolve (integration, real RLS)", () => {
  it("resolves an active key → its tenant + scopes", async () => {
    const r = await svc.resolve(ACTIVE_RAW);
    expect(r).toEqual({
      tenantId: TENANT,
      scopes: ["sms:send"],
      // keyId = sha-256 prefix of the presented key — per-key rate-limit bucket, no raw material.
      keyId: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  it("returns null for a revoked key (api_key_auth_lookup filters status='active')", async () => {
    expect(await svc.resolve(REVOKED_RAW)).toBeNull();
  });

  it("returns null for an unknown key (no possession match)", async () => {
    expect(await svc.resolve(UNKNOWN_RAW)).toBeNull();
  });

  it("returns null for a malformed (non-sk_) key without touching the DB", async () => {
    expect(await svc.resolve("not-a-key")).toBeNull();
  });
});

describe("sandbox key minting (ADR-0002 F3)", () => {
  const SANDBOX = "cccccccc-dddd-4ddd-8ddd-cccccccccccc";

  beforeAll(async () => {
    await owner.unsafe(
      "INSERT INTO accounts (id, name, slug, plan) VALUES ($1, 'Sandbox C', 'sandbox-c-f3', 'sandbox') ON CONFLICT (id) DO NOTHING",
      [SANDBOX],
    );
  });

  afterAll(async () => {
    await owner.unsafe("DELETE FROM api_keys WHERE tenant_id = $1", [SANDBOX]);
    await owner.unsafe("DELETE FROM accounts WHERE id = $1", [SANDBOX]);
  });

  it("refuses a live key for a sandbox-plan tenant; test keys still mint", async () => {
    await expect(svc.create(SANDBOX, { env: "live" })).rejects.toMatchObject({
      status: 400,
    });
    const created = await svc.create(SANDBOX, { env: "test" });
    expect(created.raw.startsWith("sk_test_")).toBe(true);
  });
});

describe("ApiKeyGuard (integration, real resolve)", () => {
  it("attaches req.tenant for a valid key", async () => {
    const { ctx, req } = ctxWithBearer(ACTIVE_RAW);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenant).toEqual({
      id: TENANT,
      scopes: ["sms:send"],
      keyId: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  it("401s (F8.3 auth_error) for an unknown key", async () => {
    const { ctx } = ctxWithBearer(UNKNOWN_RAW);
    try {
      await guard.canActivate(ctx);
      expect.unreachable("guard should reject unknown key");
    } catch (e) {
      const ex = e as {
        getStatus(): number;
        getResponse(): ApiErrorEnvelope;
      };
      expect(ex.getStatus()).toBe(401);
      expect(ex.getResponse().error.type).toBe("auth_error");
    }
  });

  // ADR-0003 / F1 acceptance: a tenant that exists only as a DB row (no minted key, exactly like a
  // runtime-provisioned org) is reachable through the guard with a freshly minted tenant token —
  // the full BFF data-plane round-trip minus HTTP framing.
  it("accepts a minted bfft_ tenant token for a provisioned tenant with NO api key", async () => {
    const secretConfig = {
      get: (key: string) =>
        key === "TENANT_TOKEN_SECRET" ? "integration-secret" : undefined,
    } as unknown as ConfigService;
    const tokens = new TenantTokenService(secretConfig);
    const tokenGuard = new ApiKeyGuard(
      svc,
      new RateLimitService({
        get: () => undefined,
      } as unknown as ConfigService),
      tokens,
    );
    const { token } = tokens.mint(TENANT);
    const { ctx, req } = ctxWithBearer(token);
    await expect(tokenGuard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenant).toEqual({
      id: TENANT,
      scopes: ["*"],
      keyId: `bfft_${TENANT.slice(0, 12)}`,
    });
  });
});
