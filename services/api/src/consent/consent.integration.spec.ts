// ============================================================================================
// E10-S5 — consent/DND enforcement against the booted app + real DB. Proves the NCC 2442
// semantics at send time: promotional blocked for a DND (promotional-scope) opt-out while
// TRANSACTIONAL STILL FLOWS; "all" scope suppresses everything; removal restores; quiet hours
// bind promo only (deterministic against the pure window fn). tier: test:integration.
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
import { promoWindowOpen } from "./consent.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "consent integration needs DATABASE_URL_SUPER + DATABASE_URL_APP",
  );
}
process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = "";

// Sandbox tenant: skips the sender gate (E10-S4) so this spec isolates CONSENT behavior.
const TENANT = "abcdabcd-6666-4666-8666-00000000e105";
const KEY = `sk_test_${"5".repeat(40)}`;
const SUFFIX = `${Math.floor(Math.random() * 900000) + 100000}`;
const RECIPIENT = `+23320${SUFFIX}1`;

const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 2 });
let app: NestFastifyApplication;

async function send(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/sms/send",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
    },
    payload: {
      to: RECIPIENT,
      sender_id: "FABRIC",
      body: "consent gate test",
      currency: "GHS",
      ...payload,
    },
  });
}

async function optOuts(
  method: "GET" | "POST" | "DELETE",
  suffix = "",
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/v1/opt-outs${suffix}`,
    headers: {
      authorization: `Bearer ${KEY}`,
      // content-type only WITH a body — Fastify 400s an empty JSON body otherwise.
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

beforeAll(async () => {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug, plan) VALUES ($1, 'Consent Co', $2, 'sandbox') ON CONFLICT (id) DO NOTHING",
    [TENANT, `consent-co-${TENANT.slice(0, 8)}`],
  );
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, 'sk_test_cnsn', $2, 'test', '["sms:send","sms:read"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [TENANT, hashApiKey(KEY)],
  );
  await db.withTenant(TENANT, (tx) =>
    credit(tx, {
      currency: "GHS",
      amountMinor: 10_000n,
      idempotencyKey: `topup:consent-seed-${TENANT}`,
    }),
  );
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
  for (const table of [
    "opt_outs",
    "ledger_entries",
    "ledger_transactions",
    "ledger_accounts",
    "messages",
    "api_keys",
  ]) {
    await owner.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT]);
  }
  await owner.unsafe("DELETE FROM accounts WHERE id = $1", [TENANT]);
  await owner.end();
  await db.end();
});

describe("consent / DND enforcement (E10-S5)", () => {
  let optOutId = "";

  it("DND (promotional scope): promo blocked, transactional STILL FLOWS — the NCC semantics", async () => {
    const added = await optOuts("POST", "", {
      msisdn: RECIPIENT,
      scope: "promotional",
    });
    expect(added.statusCode).toBe(201);
    const dto = added.json() as { id: string; msisdn: string };
    optOutId = dto.id;
    expect(dto.msisdn).not.toContain(SUFFIX); // masked — raw number never echoed

    const promo = await send({ class: "promotional" });
    expect(promo.statusCode).toBe(400);
    // Suppression is checked before quiet hours, so this is deterministic day or night.
    expect((promo.json() as { error: { code: string } }).error.code).toBe(
      "recipient_opted_out",
    );

    const transactional = await send({});
    expect(transactional.statusCode).toBe(201); // OTP/receipts bypass DND 24/7
  });

  it("'all' scope suppresses transactional too (the customer's own do-not-contact list)", async () => {
    const upgraded = await optOuts("POST", "", {
      msisdn: RECIPIENT,
      scope: "all",
    });
    expect(upgraded.statusCode).toBe(201);
    expect((upgraded.json() as { id: string }).id).toBe(optOutId); // upsert, not a second row

    const transactional = await send({});
    expect(transactional.statusCode).toBe(400);
    expect(
      (transactional.json() as { error: { code: string } }).error.code,
    ).toBe("recipient_opted_out");
  });

  it("refuses to remove a regulatory registry suppression", async () => {
    const [registry] = await owner<{ id: string }[]>`
      INSERT INTO opt_outs (
        tenant_id, msisdn_hash, msisdn_masked, scope, source
      ) VALUES (
        ${TENANT}, ${`registry-${SUFFIX}`}, ${`+23320•••${SUFFIX.slice(-4)}`},
        'promotional', 'registry'
      ) RETURNING id
    `;
    if (!registry) throw new Error("registry opt-out insert returned no row");
    const removed = await optOuts("DELETE", `/${registry.id}`);
    expect(removed.statusCode).toBe(400);
    expect((removed.json() as { error: { code: string } }).error.code).toBe(
      "managed_opt_out",
    );
    await owner`DELETE FROM opt_outs WHERE id = ${registry.id}`;
  });

  it("removal restores delivery; the list reflects it", async () => {
    const removed = await optOuts("DELETE", `/${optOutId}`);
    expect(removed.statusCode).toBe(200);
    const list = await optOuts("GET");
    expect((list.json() as { opt_outs: unknown[] }).opt_outs).toHaveLength(0);
    const transactional = await send({});
    expect(transactional.statusCode).toBe(201);
  });

  it("quiet hours bind promo only — asserted against the pure window fn (deterministic)", async () => {
    const open = promoWindowOpen(new Date(), "GH");
    const promo = await send({ class: "promotional", to: `+23320${SUFFIX}2` });
    if (open) {
      expect(promo.statusCode).toBe(201);
    } else {
      expect(promo.statusCode).toBe(400);
      expect((promo.json() as { error: { code: string } }).error.code).toBe(
        "promo_quiet_hours",
      );
    }
    // Transactional never sees the window.
    const otp = await send({ to: `+23320${SUFFIX}3` });
    expect(otp.statusCode).toBe(201);
  });
});
