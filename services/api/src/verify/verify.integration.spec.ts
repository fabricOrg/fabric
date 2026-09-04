// ============================================================================================
// V1 Verify (OTP) — end-to-end against a real migrated DB + the booted app (fake provider).
// Proves the golden-path core: start → OTP billed as a real ledgered SMS → check (wrong codes
// bounded, expiry enforced, correct code verifies, re-check idempotent) → sandbox debug_code
// present for sandbox tenants and ABSENT for live ones. tier: test:integration.
// ============================================================================================

import { unwrapEnvelope } from "@app/contracts";
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
    "api_idempotency_keys",
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

async function post(
  rawKey: string,
  url: string,
  payload: unknown,
  idempotencyKey?: string,
) {
  return app.inject({
    method: "POST",
    url,
    headers: {
      authorization: `Bearer ${rawKey}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    payload: payload as Record<string, unknown>,
  });
}

type Injected = Awaited<ReturnType<typeof post>>;

/**
 * A bare `expect(res.statusCode).toBe(201)` fails as "expected 400 to be 201" and carries nothing
 * else. The API does not log 4xx bodies, so this spec's one CI failure (2026-08-08) was undiagnosable
 * after the fact — the status alone could not say WHICH error fired. Asserting an object instead
 * means the structured `error.code` rides along in the failure diff.
 */
function expectStatus(res: Injected, expected: number): void {
  const actual =
    res.statusCode === expected
      ? { statusCode: expected }
      : { statusCode: res.statusCode, body: res.body.slice(0, 400) };
  expect(actual).toEqual({ statusCode: expected });
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
    const startKey = `verify-start-${SUFFIX}`;
    const started = await post(
      SANDBOX_KEY,
      "/v1/verify",
      { to: PHONE },
      startKey,
    );
    expectStatus(started, 201);
    const startBody = unwrapEnvelope(started.json()) as {
      id: string;
      status: string;
      debug_code?: string;
      to: string;
      expires_at: string;
      expires_in: number;
    };
    expect(startBody.status).toBe("pending");
    // Assert the EXACT mask, not a substring probe. The previous assertion searched for "227189" — a
    // fragment of the pinned pilot number that no longer exists anywhere in this spec, so it could
    // never match and proved nothing. `maskMsisdn` keeps the first 6 chars and last 4.
    expect(startBody.to).toBe(`+23354•••${SUFFIX.slice(-3)}1`);
    // Sandbox quickstart affordance: the OTP is visible without a real phone.
    expect(startBody.debug_code).toMatch(/^\d{6}$/);

    // AGE the stored claim before replaying. Two POSTs milliseconds apart cannot tell a recomputed
    // countdown from a verbatim one — with the response body's own `expires_at` pushed back to 30
    // seconds out, a verbatim replay would still answer 300 and the assertions below would fail.
    // The instant comes from THIS process, not the database: postgres `now()` can sit seconds away
    // from the API's clock, and the assertion below measures the gap between them.
    const agedExpiry = new Date(Date.now() + 30_000).toISOString();
    await owner.unsafe(
      `UPDATE api_idempotency_keys
          SET response = jsonb_set(response, '{expires_at}', to_jsonb($3::text))
        WHERE tenant_id = $1 AND key = $2`,
      [SANDBOX_TENANT, startKey, agedExpiry],
    );
    const replayed = await post(
      SANDBOX_KEY,
      "/v1/verify",
      { to: PHONE },
      startKey,
    );
    expectStatus(replayed, 201);
    const replayBody = unwrapEnvelope(replayed.json()) as {
      id: string;
      debug_code?: string;
      expires_at: string;
      expires_in: number;
    };
    expect(replayBody.id).toBe(startBody.id);
    expect(replayBody.debug_code).toBeUndefined();
    // The absolute expiry is stored and replayed as-is; the RELATIVE one is recomputed against it,
    // so a replay can never hand back a countdown longer than the code has left. Replaying the
    // stored payload verbatim is what made `expires_in` outlive the code.
    expect(replayBody.expires_in).toBeGreaterThan(0);
    expect(replayBody.expires_in).toBeLessThanOrEqual(30);
    expect(
      Math.abs(
        Date.parse(replayBody.expires_at) -
          (Date.now() + replayBody.expires_in * 1000),
      ),
    ).toBeLessThan(2_000);

    const [dedupe] = (await owner.unsafe(
      `SELECT
         (SELECT count(*)::int FROM verifications WHERE tenant_id = $1) AS verifications,
         (SELECT count(*)::int FROM messages WHERE tenant_id = $1) AS messages`,
      [SANDBOX_TENANT],
    )) as Array<{ verifications: number; messages: number }>;
    expect(dedupe).toEqual({ verifications: 1, messages: 1 });

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
    expectStatus(wrong, 400);
    expect(
      (unwrapEnvelope(wrong.json()) as { error: { code: string } }).error.code,
    ).toBe("verification_invalid_code");

    // Correct code verifies.
    const ok = await post(SANDBOX_KEY, "/v1/verify/check", {
      id: startBody.id,
      code: startBody.debug_code,
    });
    expectStatus(ok, 201);
    expect((unwrapEnvelope(ok.json()) as { status: string }).status).toBe(
      "verified",
    );

    // Re-check of a verified id = idempotent success.
    const again = await post(SANDBOX_KEY, "/v1/verify/check", {
      id: startBody.id,
      code: startBody.debug_code,
    });
    expect((unwrapEnvelope(again.json()) as { status: string }).status).toBe(
      "verified",
    );
  });

  it("throttles an immediate resend to the same number", async () => {
    const throttlePhone = `+23354${SUFFIX}9`;
    const started = await post(SANDBOX_KEY, "/v1/verify", {
      to: throttlePhone,
    });
    expectStatus(started, 201);
    const { id } = unwrapEnvelope(started.json()) as { id: string };
    // A cloud-backed SMS acceptance can itself exceed the 30-second resend window. Pin the
    // persisted start time to now so this case tests the throttle boundary, not database latency.
    await owner.unsafe(
      "UPDATE verifications SET created_at = now() WHERE tenant_id = $1 AND id = $2",
      [SANDBOX_TENANT, id],
    );
    const res = await post(SANDBOX_KEY, "/v1/verify", {
      to: throttlePhone,
    });
    expectStatus(res, 400);
    expect(
      (unwrapEnvelope(res.json()) as { error: { code: string } }).error.code,
    ).toBe("verify_resend_throttled");
  });

  it("exhausts after max wrong attempts and rejects further checks", async () => {
    const started = await post(SANDBOX_KEY, "/v1/verify", {
      to: `+23324${SUFFIX}2`,
    });
    expectStatus(started, 201); // a throttled/failed start would cascade confusingly
    const { id, debug_code } = unwrapEnvelope(started.json()) as {
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
    expectStatus(after, 400);
    expect(
      (unwrapEnvelope(after.json()) as { error: { code: string } }).error.code,
    ).toBe("verification_exhausted");
  });

  it("rejects an expired code (expiry forced in the DB)", async () => {
    const started = await post(SANDBOX_KEY, "/v1/verify", {
      to: `+23324${SUFFIX}3`,
    });
    // This is the assertion that failed once in CI (#253) as a bare `400 ≠ 201`. It now reports the
    // error body, which is the only way the next occurrence gets diagnosed.
    expectStatus(started, 201);
    const { id, debug_code } = unwrapEnvelope(started.json()) as {
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
    expectStatus(res, 400);
    expect(
      (unwrapEnvelope(res.json()) as { error: { code: string } }).error.code,
    ).toBe("verification_expired");
  });

  it("overview: real funnel + recent list, masked recipients (V2 surface)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/verify/overview",
      headers: { authorization: `Bearer ${SANDBOX_KEY}` },
    });
    expectStatus(res, 200);
    const overview = unwrapEnvelope(res.json()) as {
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
    expectStatus(started, 201);
    expect(
      (unwrapEnvelope(started.json()) as { debug_code?: string }).debug_code,
    ).toBeUndefined();
  });
});
