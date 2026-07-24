import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import {
  cleanManagedTenant,
  seedManagedEmailDefinition,
  seedManagedTenant,
} from "./managed-messages.spec-harness.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.TENANT_TOKEN_SECRET ??= "integration-test-tenant-token-secret";

describeDb("SDK-007 managed email acceptance", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");
  const tenantId = randomUUID();
  const lowFundsTenantId = randomUUID();
  const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  const lowFundsKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  let applicationId = "";
  let environmentId = "";
  let lowFundsApplicationId = "";
  let lowFundsEnvironmentId = "";
  let app: NestFastifyApplication;
  let vault: PiiVaultService;

  const payload = {
    key: "order.email",
    to: "ada@example.test",
    data: { name: "Ada", count: 2 },
    currency: "GHS",
    reference: "email-order-42",
    metadata: { source: "integration" },
  };

  function send(
    body: Record<string, unknown>,
    idempotencyKey: string,
    bearer = rawKey,
  ) {
    return app.inject({
      method: "POST",
      url: "/v1/message-deliveries",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: body,
    });
  }

  async function counts(forTenant = tenantId) {
    const q = async (table: string) => {
      const rows = await owner.unsafe(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
        [forTenant],
      );
      return Number(rows[0]?.n ?? 0);
    };
    const typed = async (eventType: string) => {
      const rows = await owner`
        SELECT count(*)::int AS n FROM outbox_events
        WHERE tenant_id = ${forTenant} AND event_type = ${eventType}`;
      return Number(rows[0]?.n ?? 0);
    };
    return {
      smsMessages: await q("messages"),
      emailMessages: await q("email_messages"),
      emailDispatches: await q("email_dispatches"),
      deliveries: await q("message_deliveries"),
      attempts: await q("message_delivery_attempts"),
      outbox: await q("outbox_events"),
      accepted: await typed("message.accepted"),
      created: await typed("message.created"),
      reserves: await q("ledger_transactions"),
    };
  }

  async function reservedBalance(forTenant = tenantId) {
    const rows = await owner`
      SELECT COALESCE(sum(balance_minor), 0)::bigint AS balance
      FROM ledger_accounts
      WHERE tenant_id = ${forTenant} AND kind = 'reserved_clearing'`;
    return BigInt(String(rows[0]?.balance ?? "0"));
  }

  async function storedEmailContent(messageId: string) {
    const rows = await owner`
      SELECT content_pii_id FROM email_messages WHERE id = ${messageId}`;
    const piiId = rows[0]?.content_pii_id;
    if (!piiId) throw new Error("email content pii id missing");
    const raw = await vault.read(tenantId, String(piiId));
    if (!raw) throw new Error("email content unreadable");
    return JSON.parse(raw) as {
      to: string;
      from: string;
      subject: string;
      text?: string;
      html?: string;
    };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = appUrl;
    const seeded = await seedManagedTenant({ owner, db, tenantId, rawKey });
    applicationId = seeded.applicationId;
    environmentId = seeded.environmentId;
    await seedManagedEmailDefinition({
      owner,
      tenantId,
      applicationId,
      environmentId,
      key: "order.email",
    });
    await seedManagedEmailDefinition({
      owner,
      tenantId,
      applicationId,
      environmentId,
      key: "order.email.from",
      from: "orders@sandbox.fabric.dev",
    });
    const lowFunds = await seedManagedTenant({
      owner,
      db,
      tenantId: lowFundsTenantId,
      rawKey: lowFundsKey,
      fundMinor: 1n,
    });
    lowFundsApplicationId = lowFunds.applicationId;
    lowFundsEnvironmentId = lowFunds.environmentId;
    await seedManagedEmailDefinition({
      owner,
      tenantId: lowFundsTenantId,
      applicationId: lowFundsApplicationId,
      environmentId: lowFundsEnvironmentId,
      key: "order.email",
    });
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    vault = app.get(PiiVaultService);
  });

  afterAll(async () => {
    await app?.close();
    await cleanManagedTenant(owner, lowFundsTenantId);
    await cleanManagedTenant(owner, tenantId);
    await Promise.all([owner.end(), db.end()]);
  });

  it("accepts and persists one managed email without direct created outbox", async () => {
    const response = await send(payload, "email-accept-001");
    expect(response.statusCode).toBe(202);
    const delivery = (response.json() as { delivery: Record<string, unknown> })
      .delivery;
    expect(delivery).toMatchObject({
      key: "order.email",
      channel: "email",
      status: "accepted",
      recipient: "ada@example.test",
      cost: { minor: "5", currency: "GHS" },
    });
    const attempts = delivery.attempts as Array<Record<string, unknown>>;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      channel: "email",
      message_id: null,
      status: "accepted",
      cost: { minor: "5", currency: "GHS" },
    });

    const deliveryId = String(delivery.id);
    const rows = await owner`
      SELECT a.email_message_id, a.message_id, m.status::text, d.message_id AS dispatch_id
      FROM message_delivery_attempts a
      JOIN email_messages m ON m.id = a.email_message_id
      JOIN email_dispatches d ON d.message_id = m.id
      WHERE a.tenant_id = ${tenantId} AND a.delivery_id = ${deliveryId}`;
    expect(rows[0]).toMatchObject({
      email_message_id: deliveryId,
      message_id: null,
      status: "queued",
      dispatch_id: deliveryId,
    });
    expect(await counts()).toMatchObject({
      emailMessages: 1,
      emailDispatches: 1,
      deliveries: 1,
      attempts: 1,
      accepted: 1,
      created: 0,
    });
    expect(await reservedBalance()).toBe(5n);
  });

  it("replays the same request without a second reserve or row", async () => {
    const before = await counts();
    const first = await send(payload, "email-accept-001");
    const second = await send(payload, "email-accept-001");
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect((second.json() as { delivery: { id: string } }).delivery.id).toBe(
      (first.json() as { delivery: { id: string } }).delivery.id,
    );
    expect(await counts()).toEqual(before);
    expect(await reservedBalance()).toBe(5n);
  });

  it("409s on idempotency conflict without a second reserve", async () => {
    const before = await counts();
    const response = await send(
      { ...payload, data: { name: "Grace", count: 3 } },
      "email-accept-001",
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    expect(await counts()).toEqual(before);
  });

  it("rolls back every email acceptance row on insufficient funds", async () => {
    const before = await counts(lowFundsTenantId);
    const response = await send(payload, "email-low-funds", lowFundsKey);
    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({
      error: { code: "insufficient_funds" },
    });
    expect(await counts(lowFundsTenantId)).toEqual(before);
  });

  it("rejects an SMS-shaped recipient for an email definition before persistence", async () => {
    const before = await counts();
    const response = await send(
      { ...payload, to: "+233200000042" },
      "email-recipient-mismatch",
    );
    expect(response.statusCode).toBe(400);
    const body = response.json() as {
      error: { code: string; message: string; param?: string };
    };
    expect(body.error).toMatchObject({
      code: "recipient_channel_mismatch",
      param: "to",
    });
    expect(body.error.message).not.toContain("+233200000042");
    expect(await counts()).toEqual(before);
  });

  it("stores the sandbox fallback sender and authored sender in vault content", async () => {
    const fallback = await send(
      { ...payload, to: "fallback@example.test" },
      "email-from-fallback",
    );
    expect(fallback.statusCode).toBe(202);
    const fallbackId = (fallback.json() as { delivery: { id: string } })
      .delivery.id;
    await expect(storedEmailContent(fallbackId)).resolves.toMatchObject({
      from: "no-reply@sandbox.fabric.dev",
    });

    const authored = await send(
      {
        ...payload,
        key: "order.email.from",
        to: "authored@example.test",
      },
      "email-from-authored",
    );
    expect(authored.statusCode).toBe(202);
    const authoredId = (authored.json() as { delivery: { id: string } })
      .delivery.id;
    await expect(storedEmailContent(authoredId)).resolves.toMatchObject({
      from: "orders@sandbox.fabric.dev",
    });
  });

  it("still sends managed SMS through the same endpoint", async () => {
    const response = await send(
      {
        key: "order.shipped",
        to: "+233200000042",
        data: { name: "Ada", count: 2 },
        currency: "GHS",
      },
      "sms-regression",
    );
    expect(response.statusCode).toBe(202);
    const delivery = (response.json() as { delivery: Record<string, unknown> })
      .delivery;
    expect(delivery).toMatchObject({
      key: "order.shipped",
      channel: "sms",
    });
    const attempts = delivery.attempts as Array<Record<string, unknown>>;
    expect(attempts[0]).toMatchObject({ channel: "sms" });
  });
});
