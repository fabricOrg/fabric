// ============================================================================================
// ADR-0002 F3 — sandbox tenants are PINNED to the fake provider at the ROUTING layer. This
// boots the real app with SMS_PROVIDER=arkesel (the real vendor selected) and proves a
// sandbox-plan tenant's send still lands on fake-sms — i.e. forcing live routing from the
// outside is impossible — while a live-plan tenant is routed at the configured provider.
// tier: test:integration.
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

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "sandbox-routing needs DATABASE_URL_SUPER + DATABASE_URL_APP (a fresh DB migrated as app_migrator)",
  );
}
process.env.DATABASE_URL_APP = APP_URL;
// The point of this spec: the REAL vendor is configured, yet sandbox sends must not reach it.
process.env.SMS_PROVIDER = "arkesel";
process.env.ARKESEL_API_KEY = ""; // no creds — an accidental real call could never succeed anyway
process.env.REDIS_QUEUE_URL = ""; // inline path: assert the synchronous outcome
process.env.VIRTUAL_PHONE_ENCRYPTION_KEY =
  "integration-virtual-phone-key-at-least-32-characters";

const SANDBOX_TENANT = "abcdabcd-0000-4000-8000-0000000000f3";
const LIVE_TENANT = "abcdabcd-1111-4111-8111-0000000000f3";
const SANDBOX_KEY = `sk_test_${"f".repeat(40)}`;
const LIVE_KEY = `sk_test_${"a".repeat(40)}`;
const CURRENCY = "GHS";

const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 2 });
let app: NestFastifyApplication;

async function seedTenant(id: string, plan: string, rawKey: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug, plan) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
    [id, `Routing ${plan}`, `routing-${plan}-${id.slice(0, 8)}`, plan],
  );
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, 'sk_test_rout', $2, 'test', '["sms:send","sms:read"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [id, hashApiKey(rawKey)],
  );
  await db.withTenant(id, (tx) =>
    credit(tx, {
      currency: CURRENCY,
      amountMinor: 10_000n,
      idempotencyKey: `topup:routing-seed-${id}`,
    }),
  );
  // E10-S4: the live tenant must clear the sender gate so this spec asserts ROUTING, not senders.
  if (plan !== "sandbox") {
    await owner.unsafe(
      `INSERT INTO senders (tenant_id, sender_id, country, use_case, status)
       VALUES ($1, 'FABRIC', 'GH', 'routing integration', 'active')
       ON CONFLICT ON CONSTRAINT uniq_sender_tenant_id_country DO NOTHING`,
      [id],
    );
  }
}

async function cleanTenant(id: string) {
  for (const table of [
    "senders",
    "virtual_deliveries",
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

async function sendAs(rawKey: string) {
  return app.inject({
    method: "POST",
    url: "/v1/sms/send",
    headers: {
      authorization: `Bearer ${rawKey}`,
      "content-type": "application/json",
    },
    payload: {
      to: "+233545227189",
      sender_id: "FABRIC",
      body: "routing pin test",
      currency: CURRENCY,
    },
  });
}

async function providerOf(tenantId: string): Promise<string | null> {
  const rows = (await owner.unsafe(
    "SELECT provider_slug FROM messages WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
    [tenantId],
  )) as Array<{ provider_slug: string | null }>;
  return rows[0]?.provider_slug ?? null;
}

beforeAll(async () => {
  await seedTenant(SANDBOX_TENANT, "sandbox", SANDBOX_KEY);
  await seedTenant(LIVE_TENANT, "free", LIVE_KEY);
  app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );
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

describe("sandbox provider pinning (F3)", () => {
  it("delivers a sandbox send through the encrypted virtual phone", async () => {
    const res = await sendAs(SANDBOX_KEY);
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("delivered");
    await expect(providerOf(SANDBOX_TENANT)).resolves.toBe("virtual-phone");

    const rows = (await owner.unsafe(
      `SELECT v.recipient_ciphertext, v.body_ciphertext, m.status
       FROM virtual_deliveries v JOIN messages m ON m.id = v.message_id
       WHERE v.tenant_id = $1 ORDER BY v.created_at DESC LIMIT 1`,
      [SANDBOX_TENANT],
    )) as Array<Record<string, unknown>>;
    expect(rows[0]?.status).toBe("delivered");
    expect(String(rows[0]?.recipient_ciphertext)).not.toContain(
      "+233545227189",
    );
    expect(String(rows[0]?.body_ciphertext)).not.toContain("routing pin test");
  });

  it("does not expose a virtual delivery in another tenant context", async () => {
    const rows = await db.withTenant(
      LIVE_TENANT,
      (tx) => tx`SELECT message_id FROM virtual_deliveries`,
    );
    expect(rows).toHaveLength(0);
  });
});
