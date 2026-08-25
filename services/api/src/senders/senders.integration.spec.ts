// ============================================================================================
// E10-S4 — sender-id registry + SEND-TIME enforcement against the booted app + real DB.
// Proves: a LIVE tenant's send is BLOCKED (structured sender_not_registered) until staff
// activate the registration, then flows; a sandbox tenant never hits the gate. tier:
// test:integration.
// ============================================================================================

import { unwrapEnvelope } from "@app/contracts";
import { createAppDb, createProvisioningDb } from "@app/db";
import { credit } from "@app/wallet";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "../api-keys/api-key.crypto.js";
import { AppModule } from "../app.module.js";
import { AuditService } from "../audit/audit.service.js";
import { EffectivePricingService } from "../pricing/effective-pricing.service.js";
import { effectivePricingStub } from "../testing/effective-pricing.stub.js";
import { SendersService } from "./senders.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const PROVISIONER_URL = process.env.DATABASE_URL_PROVISIONER;
if (!SUPER_URL || !APP_URL || !PROVISIONER_URL) {
  throw new Error(
    "senders integration needs DATABASE_URL_SUPER + DATABASE_URL_APP + DATABASE_URL_PROVISIONER",
  );
}
process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = "";

const LIVE_TENANT = "abcdabcd-4444-4444-8444-00000000e104";
const SANDBOX_TENANT = "abcdabcd-5555-4555-8555-00000000e104";
const LIVE_KEY = `sk_test_${"7".repeat(40)}`;
const SANDBOX_KEY = `sk_test_${"6".repeat(40)}`;

const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 2 });
let app: NestFastifyApplication;

async function seedTenant(id: string, plan: string, rawKey: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug, plan) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
    [id, `Senders ${plan}`, `senders-${plan}-${id.slice(0, 8)}`, plan],
  );
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, 'sk_test_sndr', $2, 'test', '["sms:send","sms:read"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [id, hashApiKey(rawKey)],
  );
  await db.withTenant(id, (tx) =>
    credit(tx, {
      currency: "GHS",
      amountMinor: 10_000n,
      idempotencyKey: `topup:senders-seed-${id}`,
    }),
  );
}

async function cleanTenant(id: string) {
  for (const table of [
    "senders",
    "ledger_entries",
    "ledger_transactions",
    "ledger_accounts",
    "messages",
    "api_keys",
    "audit_events",
  ]) {
    const column = table === "audit_events" ? "target_id" : "tenant_id";
    await owner.unsafe(`DELETE FROM ${table} WHERE ${column} = $1`, [id]);
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

const smsPayload = {
  to: "+233545227189",
  sender_id: "ACMEGH",
  body: "sender gate test",
  currency: "GHS",
};

beforeAll(async () => {
  await seedTenant(LIVE_TENANT, "free", LIVE_KEY);
  await seedTenant(SANDBOX_TENANT, "sandbox", SANDBOX_KEY);
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
  await cleanTenant(LIVE_TENANT);
  await cleanTenant(SANDBOX_TENANT);
  await owner.end();
  await db.end();
});

describe("sender-id enforcement (E10-S4)", () => {
  it("blocks a LIVE tenant's send with sender_not_registered until activation, then flows", async () => {
    // 1. Unregistered → structured block, no message row, no money moved.
    const blocked = await post(LIVE_KEY, "/v1/sms/messages", smsPayload);
    expect(blocked.statusCode).toBe(400);
    expect(
      (unwrapEnvelope(blocked.json()) as { error: { code: string } }).error
        .code,
    ).toBe("sender_not_registered");
    const [msgCount] = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM messages WHERE tenant_id = $1",
      [LIVE_TENANT],
    )) as Array<{ n: number }>;
    expect(msgCount?.n).toBe(0);

    // 2. Register (pending) → still blocked: pending is not active.
    const registered = await post(LIVE_KEY, "/v1/senders", {
      sender_id: "ACMEGH",
      country: "GH",
      use_case: "Order notifications for our Ghana shop.",
    });
    expect(registered.statusCode).toBe(201);
    const senderRow = unwrapEnvelope(registered.json()) as {
      id: string;
      status: string;
    };
    expect(senderRow.status).toBe("pending");
    const stillBlocked = await post(LIVE_KEY, "/v1/sms/messages", smsPayload);
    expect(stillBlocked.statusCode).toBe(400);

    // 3. Staff activate (provisioning connection) → the send flows.
    const provisioning = createProvisioningDb(PROVISIONER_URL ?? "", {
      max: 1,
    });
    const service = new SendersService(
      db,
      provisioning,
      new AuditService(provisioning),
    );
    const actor = { email: "ops@fabric.dev", staffId: null };

    // 3a. Activating BEFORE the carrier approved is refused. Arkesel has no registration API, so
    // an `active` sender the network never approved would be rejected at send time with PROHIBITED
    // while the dashboard claimed it was ready — the exact lie this gate exists to prevent.
    await expect(
      service.decide(senderRow.id, { status: "active" }, actor),
    ).rejects.toSatisfy(
      (error: unknown) =>
        (
          error as { getResponse?: () => { error?: { code?: string } } }
        ).getResponse?.()?.error?.code === "carrier_not_approved",
    );
    const blockedByCarrier = await post(
      LIVE_KEY,
      "/v1/sms/messages",
      smsPayload,
    );
    expect(blockedByCarrier.statusCode).toBe(400);

    // 3b. Operator records the carrier's approval, THEN activates the customer.
    await service.setCarrierStatus(
      senderRow.id,
      { carrier_status: "approved", carrier_ref: "ARK-TEST-1" },
      actor,
    );
    await service.decide(senderRow.id, { status: "active" }, actor);
    const sent = await post(LIVE_KEY, "/v1/sms/messages", smsPayload);
    expect(sent.statusCode).toBe(201);
    await provisioning.end();
  });

  it("duplicate registration for the same (sender, country) is refused", async () => {
    const dup = await post(LIVE_KEY, "/v1/senders", {
      sender_id: "ACMEGH",
      country: "GH",
      use_case: "duplicate registration attempt",
    });
    expect(dup.statusCode).toBe(400);
    expect(
      (unwrapEnvelope(dup.json()) as { error: { code: string } }).error.code,
    ).toBe("sender_already_registered");
  });

  it("SANDBOX tenants skip the gate entirely (fake provider, quickstart sender works)", async () => {
    const res = await post(SANDBOX_KEY, "/v1/sms/messages", smsPayload);
    expect(res.statusCode).toBe(201);
  });
});
