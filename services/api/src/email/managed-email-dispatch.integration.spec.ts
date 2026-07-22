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
import {
  cleanManagedTenant,
  seedManagedEmailDefinition,
  seedManagedTenant,
} from "../messages/managed-messages.spec-harness.js";
import { EmailService } from "./email.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.TENANT_TOKEN_SECRET ??= "integration-test-tenant-token-secret";

describeDb("SDK-007 managed email dispatch money resolution", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");
  const tenantId = randomUUID();
  const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  let app: NestFastifyApplication;
  let email: EmailService;

  async function acceptManaged(to: string, key: string): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/v1/message-deliveries",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      payload: {
        key: "order.email",
        to,
        data: { name: "Ada", count: 2 },
        currency: "GHS",
      },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json() as { delivery: { id: string } };
    return body.delivery.id;
  }

  async function customerBalance(): Promise<bigint> {
    const rows = await owner`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'`;
    return BigInt(String(rows[0]?.balance_minor ?? "0"));
  }

  async function ledgerTerminalCount(
    messageId: string,
    status: "committed" | "refunded",
  ): Promise<number> {
    const rows = await owner`
      SELECT count(*)::int AS n FROM ledger_transactions
      WHERE tenant_id = ${tenantId}
        AND reference_id = ${messageId}
        AND type = 'sms_charge'
        AND status = ${status}`;
    return Number(rows[0]?.n ?? 0);
  }

  async function deliveryState(messageId: string) {
    const rows = await owner`
      SELECT
        m.status::text AS message_status,
        a.status AS attempt_status,
        a.cost_minor,
        a.error_code AS attempt_error,
        d.status AS delivery_status,
        d.resource_version,
        d.total_cost_minor
      FROM email_messages m
      JOIN message_delivery_attempts a ON a.email_message_id = m.id
      JOIN message_deliveries d ON d.id = a.delivery_id
      WHERE m.tenant_id = ${tenantId} AND m.id = ${messageId}`;
    const row = rows[0];
    if (!row) throw new Error("managed email rows missing");
    return {
      messageStatus: String(row.message_status),
      attemptStatus: String(row.attempt_status),
      attemptCostMinor: BigInt(String(row.cost_minor)),
      attemptError: row.attempt_error ? String(row.attempt_error) : null,
      deliveryStatus: String(row.delivery_status),
      resourceVersion: Number(row.resource_version),
      totalCostMinor: BigInt(String(row.total_cost_minor)),
    };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = appUrl;
    const seeded = await seedManagedTenant({
      owner,
      db,
      tenantId,
      rawKey,
      scopes: ["messages:send", "messages:read", "email:send", "email:read"],
    });
    await seedManagedEmailDefinition({
      owner,
      tenantId,
      applicationId: seeded.applicationId,
      environmentId: seeded.environmentId,
      key: "order.email",
    });
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    email = app.get(EmailService);
  });

  afterAll(async () => {
    await app?.close();
    await cleanManagedTenant(owner, tenantId);
    await Promise.all([owner.end(), db.end()]);
  });

  it("commits the managed reserve when the provider delivers", async () => {
    const before = await customerBalance();
    const messageId = await acceptManaged("ok@example.com", "email-delivered");
    const status = await email.process({ tenantId, messageId });

    expect(status).toBe("delivered");
    expect(await customerBalance()).toBe(before - 5n);
    expect(await ledgerTerminalCount(messageId, "committed")).toBe(1);
    expect(await deliveryState(messageId)).toMatchObject({
      messageStatus: "delivered",
      attemptStatus: "delivered",
      deliveryStatus: "delivered",
      resourceVersion: 2,
    });
  });

  it("refunds the managed reserve when the provider rejects the recipient", async () => {
    const before = await customerBalance();
    const messageId = await acceptManaged(
      "reject@example.com",
      "email-undelivered",
    );
    const status = await email.process({ tenantId, messageId });

    expect(status).toBe("undelivered");
    expect(await customerBalance()).toBe(before);
    expect(await ledgerTerminalCount(messageId, "refunded")).toBe(1);
    expect(await deliveryState(messageId)).toMatchObject({
      messageStatus: "undelivered",
      attemptStatus: "undelivered",
      attemptError: "sandbox_recipient_rejected",
      deliveryStatus: "undelivered",
      resourceVersion: 2,
    });
  });

  it("refunds the managed reserve when the provider fails", async () => {
    const before = await customerBalance();
    const messageId = await acceptManaged("fail@example.com", "email-failed");
    const status = await email.process({ tenantId, messageId });

    expect(status).toBe("failed");
    expect(await customerBalance()).toBe(before);
    expect(await ledgerTerminalCount(messageId, "refunded")).toBe(1);
    expect(await deliveryState(messageId)).toMatchObject({
      messageStatus: "failed",
      attemptStatus: "failed",
      attemptError: "sandbox_provider_failure",
      deliveryStatus: "failed",
      resourceVersion: 2,
    });
  });

  it("does not double-commit or double-bump on a replayed delivered resolve", async () => {
    const messageId = await acceptManaged(
      "ok-again@example.com",
      "email-delivered-replay",
    );
    await email.process({ tenantId, messageId });
    const replay = await email.process({ tenantId, messageId });

    expect(replay).toBe("delivered");
    expect(await ledgerTerminalCount(messageId, "committed")).toBe(1);
    expect(await deliveryState(messageId)).toMatchObject({
      deliveryStatus: "delivered",
      resourceVersion: 2,
    });
  });

  it("leaves direct email sends out of managed wallet reconciliation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/email/messages",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
        "idempotency-key": "direct-email",
      },
      payload: {
        to: "direct@example.com",
        from: "hello@merchant.example",
        subject: "Direct",
        text: "No managed reservation exists.",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; status: string };

    expect(body.status).toBe("delivered");
    expect(await ledgerTerminalCount(body.id, "committed")).toBe(0);
    expect(await ledgerTerminalCount(body.id, "refunded")).toBe(0);
  });

  it("keeps managed email costs fixed after terminal resolution", async () => {
    const messageId = await acceptManaged("cost@example.com", "email-cost");
    await email.process({ tenantId, messageId });
    const state = await deliveryState(messageId);

    expect(state.attemptCostMinor).toBe(5n);
    expect(state.totalCostMinor).toBe(5n);
  });
});
