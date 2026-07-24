import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import { credit } from "@app/wallet";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "../api-keys/api-key.crypto.js";
import { AppModule } from "../app.module.js";
import { hashMsisdn } from "../consent/msisdn.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";

describeDb("public SMS batch API", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");
  const tenantId = randomUUID();
  const applicationId = randomUUID();
  const environmentId = randomUUID();
  const rawKey = `sk_test_${"4".repeat(40)}`;
  const optedOut = "+233200000099";
  let app: NestFastifyApplication;

  const payload = {
    items: [
      {
        client_reference: "valid",
        to: "+233200000001",
        sender_id: "SANDBOX",
        body: "Valid batch item",
        currency: "GHS",
      },
      {
        client_reference: "invalid",
        to: "not-e164",
        sender_id: "SANDBOX",
        body: "Invalid recipient",
        currency: "GHS",
      },
      {
        client_reference: "opted-out",
        to: optedOut,
        sender_id: "SANDBOX",
        body: "Suppressed recipient",
        currency: "GHS",
      },
    ],
  };

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = appUrl;
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'Batch API', ${`batch-${tenantId}`})`;
    await owner`
      INSERT INTO applications (id, tenant_id, name, slug)
      VALUES (${applicationId}, ${tenantId}, 'Primary', 'primary')`;
    await owner`
      INSERT INTO environments (id, tenant_id, application_id, type, status)
      VALUES (${environmentId}, ${tenantId}, ${applicationId}, 'sandbox', 'active')`;
    await owner`
      INSERT INTO api_keys (
        tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
      ) VALUES (
        ${tenantId}, ${applicationId}, ${environmentId}, 'sk_test_batch',
        ${hashApiKey(rawKey)}, 'test', '["sms:send","sms:read"]'::jsonb, 'active'
      )`;
    await owner`
      INSERT INTO opt_outs (tenant_id, msisdn_hash, msisdn_masked, scope, source)
      VALUES (${tenantId}, ${hashMsisdn(optedOut)}, '+233•••0099', 'all', 'manual')`;
    await db.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 10_000n,
        idempotencyKey: `topup:batch-${tenantId}`,
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
    await owner`DELETE FROM outbox_events WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM message_batches WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM messages WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM opt_outs WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM api_keys WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM applications WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([owner.end(), db.end()]);
  });

  it("returns durable per-recipient outcomes and replays without duplicate sends", async () => {
    const request = {
      method: "POST" as const,
      url: "/v1/sms/batches",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
        "idempotency-key": "campaign-001",
      },
      payload,
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    const result = first.json() as {
      id: string;
      status: string;
      accepted_count: number;
      failed_count: number;
      items: Array<{
        client_reference: string;
        message_id: string | null;
        error_code: string | null;
      }>;
    };
    expect(result.status).toBe("completed");
    expect(result.accepted_count).toBe(1);
    expect(result.failed_count).toBe(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client_reference: "valid",
          message_id: expect.any(String),
          error_code: null,
        }),
        expect.objectContaining({
          client_reference: "invalid",
          message_id: null,
          error_code: "invalid_sms",
        }),
        expect.objectContaining({
          client_reference: "opted-out",
          message_id: null,
          error_code: "recipient_opted_out",
        }),
      ]),
    );
    expect((replay.json() as { id: string }).id).toBe(result.id);
    const messages = await owner`
      SELECT count(*)::int AS count FROM messages WHERE tenant_id = ${tenantId}`;
    expect(Number(messages[0]?.count)).toBe(1);
  });

  it("rejects reusing a batch idempotency key with another payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sms/batches",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
        "idempotency-key": "campaign-001",
      },
      payload: { items: [payload.items[0]] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "idempotency_key_reused" },
    });
  });
});
