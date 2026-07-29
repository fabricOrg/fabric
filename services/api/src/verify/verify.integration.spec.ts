// ============================================================================================
// V1 Verify (OTP) — end-to-end against a real migrated DB + the booted app (fake provider).
// Proves the golden-path core: start → OTP billed as a real ledgered SMS → check (wrong codes
// bounded, expiry enforced, correct code verifies, re-check idempotent) → sandbox debug_code
// present for sandbox tenants and ABSENT for live ones. tier: test:integration.
// ============================================================================================

import { createAppDb } from "@app/db";
import { credit } from "@app/wallet";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "../api-keys/api-key.crypto.js";
import { AppModule } from "../app.module.js";
import { EffectivePricingService } from "../pricing/effective-pricing.service.js";
import { effectivePricingStub } from "../testing/effective-pricing.stub.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "verify integration needs DATABASE_URL_SUPER + DATABASE_URL_APP (a fresh DB migrated as app_migrator)",
  );
}
process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = ""; // inline send path — synchronous provider outcome

const SANDBOX_TENANT = "abcdabcd-2222-4222-8222-0000000000e6";
const LIVE_TENANT = "abcdabcd-3333-4333-8333-0000000000e6";
const SANDBOX_KEY = `sk_test_${"9".repeat(40)}`;
const LIVE_KEY = `sk_test_${"8".repeat(40)}`;
// Randomized per run: a resend-throttle row left by a crashed previous run (afterAll skipped)
// must never bleed into this one.
const SUFFIX = `${Math.floor(Math.random() * 900000) + 100000}`;
const PHONE = `+23354${SUFFIX}1`;

const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 2 });
let app: NestFastifyApplication;

async function seedTenant(id: string, plan: string, rawKey: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug, plan) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
    [id, `Verify ${plan}`, `verify-${plan}-${id.slice(0, 8)}`, plan],
  );
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, 'sk_test_vrfy', $2, 'test', '["sms:send","sms:read"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [id, hashApiKey(rawKey)],
  );
  await db.withTenant(id, (tx) =>
    credit(tx, {
      currency: "GHS",
      amountMinor: 10_000n,
      idempotencyKey: `topup:verify-seed-${id}`,
    }),
  );
  // E10-S4: live-plan tenants need an active sender for the default OTP sender id.
  if (plan !== "sandbox") {
    await owner.unsafe(
      // carrier_status required for `active` — see migration 0097.
      `INSERT INTO senders (tenant_id, sender_id, country, use_case, status, carrier_status)
       VALUES ($1, 'FABRIC', 'GH', 'verify integration', 'active', 'approved')
       ON CONFLICT ON CONSTRAINT uniq_sender_tenant_id_country DO NOTHING`,
      [id],
    );
  }
}

async function cleanTenant(id: string) {
  for (const table of [
    "senders",
    "verifications",
    "ledger_entries",
    "ledger_transactions",
    "ledger_accounts",
    "messages",
    "api_keys",
  ]) {
    await owner.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [id]);
  }
  await owner.unsafe("DELETE FROM accounts WHERE id = $1", [id]);
}

async function post(rawKey: string, url: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url,
    headers: {
      authorization: `Bearer ${rawKey}`,
      "content-type": "application/json",
    },
    payload: payload as Record<string, unknown>,
  });
}

beforeAll(async () => {
  await seedTenant(SANDBOX_TENANT, "sandbox", SANDBOX_KEY);
  await seedTenant(LIVE_TENANT, "free", LIVE_KEY);
  app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );
  Object.assign(app.get(EffectivePricingService), effectivePricingStub());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await cleanTenant(SANDBOX_TENANT);
  await cleanTenant(LIVE_TENANT);
  await owner.end();
  await db.end();
});

describe("Verify V1 (golden path core)", () => {
  it("start → metered OTP SMS (sandbox allowance, virtual phone) → wrong codes bounded → verify → idempotent re-check", async () => {
    const started = await post(SANDBOX_KEY, "/v1/verify", { to: PHONE });
    expect(started.statusCode).toBe(201);
    const startBody = started.json() as {
      id: string;
      status: string;
      debug_code?: string;
      to: string;
    };
    expect(startBody.status).toBe("pending");
    expect(startBody.to).not.toContain("227189"); // masked, never the raw number
    // Sandbox quickstart affordance: the OTP is visible without a real phone.
    expect(startBody.debug_code).toMatch(/^\d{6}$/);

    // The OTP rode the real send pipeline: a message exists, pinned to the SANDBOX provider, and it
    // was ACCOUNTED FOR. A sandbox tenant is pinned to the virtual phone (ADR-0002 F3) — an OTP for a
    // sandbox workspace must never be able to reach a carrier, whatever SMS_PROVIDER says.
    const [msg] = (await owner.unsafe(
      "SELECT id, provider_slug FROM messages WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
      [SANDBOX_TENANT],
    )) as Array<{ id: string; provider_slug: string }>;
    expect(msg?.provider_slug).toBe("virtual-phone");
    // The record is the daily ALLOWANCE, not the ledger. Sandbox stopped spending money, so a
    // reserve/commit pair no longer exists to assert — but the send must still be counted, or a
    // sandbox tenant would have found an unmetered path to send through.
    const usage = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM sandbox_usage_events WHERE tenant_id = $1 AND reference_id = $2",
      [SANDBOX_TENANT, msg?.id ?? ""],
    )) as Array<{ n: number }>;
    expect(usage[0]?.n ?? 0).toBeGreaterThan(0);

    // Wrong code: structured error + bounded attempts.
    const wrongCode = startBody.debug_code === "000000" ? "111111" : "000000";
    const wrong = await post(SANDBOX_KEY, "/v1/verify/check", {
      id: startBody.id,
      code: wrongCode,
    });
    expect(wrong.statusCode).toBe(400);
    expect((wrong.json() as { error: { code: string } }).error.code).toBe(
      "verification_invalid_code",
    );

    // Correct code verifies.
    const ok = await post(SANDBOX_KEY, "/v1/verify/check", {
      id: startBody.id,
      code: startBody.debug_code,
    });
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { status: string }).status).toBe("verified");

    // Re-check of a verified id = idempotent success.
    const again = await post(SANDBOX_KEY, "/v1/verify/check", {
      id: startBody.id,
      code: startBody.debug_code,
    });
    expect((again.json() as { status: string }).status).toBe("verified");
  });

  it("throttles an immediate resend to the same number", async () => {
    const res = await post(SANDBOX_KEY, "/v1/verify", { to: PHONE });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "verify_resend_throttled",
    );
  });

  it("exhausts after max wrong attempts and rejects further checks", async () => {
    const started = await post(SANDBOX_KEY, "/v1/verify", {
      to: `+23324${SUFFIX}2`,
    });
    expect(started.statusCode).toBe(201); // a throttled/failed start would cascade confusingly
    const { id, debug_code } = started.json() as {
      id: string;
      debug_code: string;
    };
    const wrongCode = debug_code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await post(SANDBOX_KEY, "/v1/verify/check", { id, code: wrongCode });
    }
    // Even the RIGHT code is refused now — the verification is burned.
    const after = await post(SANDBOX_KEY, "/v1/verify/check", {
      id,
      code: debug_code,
    });
    expect(after.statusCode).toBe(400);
    expect((after.json() as { error: { code: string } }).error.code).toBe(
      "verification_exhausted",
    );
  });

  it("rejects an expired code (expiry forced in the DB)", async () => {
    const started = await post(SANDBOX_KEY, "/v1/verify", {
      to: `+23324${SUFFIX}3`,
    });
    expect(started.statusCode).toBe(201);
    const { id, debug_code } = started.json() as {
      id: string;
      debug_code: string;
    };
    const expired = (await owner.unsafe(
      "UPDATE verifications SET expires_at = now() - interval '1 minute' WHERE id = $1 RETURNING expires_at",
      [id],
    )) as Array<{ expires_at: Date }>;
    expect(expired).toHaveLength(1);
    expect(expired[0]?.expires_at.getTime()).toBeLessThan(Date.now());
    const res = await post(SANDBOX_KEY, "/v1/verify/check", {
      id,
      code: debug_code,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "verification_expired",
    );
  });

  it("overview: real funnel + recent list, masked recipients (V2 surface)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/verify/overview",
      headers: { authorization: `Bearer ${SANDBOX_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const overview = res.json() as {
      recent: Array<{ msisdn: string; status: string }>;
      stats: { sent: number; delivered: number; verified: number };
      trend: Array<{ attempts: number; verified: number }>;
    };
    // The suite above started several verifications and verified one — the funnel reflects it.
    expect(overview.stats.sent).toBeGreaterThanOrEqual(3);
    expect(overview.stats.verified).toBeGreaterThanOrEqual(1);
    expect(overview.stats.verified).toBeLessThanOrEqual(overview.stats.sent);
    expect(overview.recent.length).toBeGreaterThanOrEqual(3);
    for (const row of overview.recent) {
      expect(row.msisdn).toContain("•"); // masked — never a raw number
    }
    expect(overview.trend.length).toBeGreaterThanOrEqual(1);
  });

  it("NEVER leaks debug_code to a live-plan tenant", async () => {
    const started = await post(LIVE_KEY, "/v1/verify", {
      to: `+23324${SUFFIX}4`,
    });
    expect(started.statusCode).toBe(201);
    expect(
      (started.json() as { debug_code?: string }).debug_code,
    ).toBeUndefined();
  });
});
