import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import type { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import {
  cleanManagedTenant,
  seedManagedEmailDefinition,
  seedManagedTenant,
} from "../messages/managed-messages.spec-harness.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { QueueService } from "../queue/queue.service.js";
import { EmailService } from "./email.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.TENANT_TOKEN_SECRET ??= "integration-test-tenant-token-secret";

describeDb("SDK-007 managed email dispatch recovery", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");
  const tenantId = randomUUID();
  const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  const COST = 5n;
  let applicationId = "";
  let environmentId = "";
  let app: NestFastifyApplication;
  let vault: PiiVaultService;
  let email: EmailService;
  let emailPaused = false;

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
    return String(
      (response.json() as { delivery: { id: string } }).delivery.id,
    );
  }

  async function customerBalance(): Promise<bigint> {
    const rows = await owner`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'`;
    return BigInt(String(rows[0]?.balance_minor ?? "0"));
  }

  async function terminalTxnCount(
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

  async function state(messageId: string) {
    const rows = await owner`
      SELECT m.status::text AS message_status, m.error_code, m.provider_ref,
             a.status AS attempt_status, a.error_code AS attempt_error,
             d.status AS delivery_status
      FROM email_messages m
      LEFT JOIN message_delivery_attempts a ON a.email_message_id = m.id
      LEFT JOIN message_deliveries d ON d.id = a.delivery_id
      WHERE m.tenant_id = ${tenantId} AND m.id = ${messageId}`;
    const row = rows[0];
    if (!row) throw new Error("email row missing");
    return {
      messageStatus: String(row.message_status),
      errorCode: row.error_code ? String(row.error_code) : null,
      providerRef: row.provider_ref ? String(row.provider_ref) : null,
      attemptStatus: row.attempt_status ? String(row.attempt_status) : null,
      attemptError: row.attempt_error ? String(row.attempt_error) : null,
      deliveryStatus: row.delivery_status ? String(row.delivery_status) : null,
    };
  }

  async function stale(messageId: string): Promise<void> {
    await owner`
      UPDATE email_messages SET updated_at = now() - interval '1 hour'
      WHERE tenant_id = ${tenantId} AND id = ${messageId}`;
  }

  async function seedDirectQueuedEmail(): Promise<string> {
    const messageId = randomUUID();
    const subjectId = await vault.subjectForEmail(
      tenantId,
      "direct-stuck@example.test",
    );
    const contentPiiId = await vault.put(
      tenantId,
      subjectId,
      "body",
      JSON.stringify({
        to: "direct-stuck@example.test",
        from: "hello@merchant.example",
        subject: "Direct",
        text: "No managed reservation exists.",
      }),
    );
    await owner`
      INSERT INTO email_messages (
        id, tenant_id, application_id, environment_id, subject_id,
        content_pii_id, status, status_rank, provider_slug, updated_at
      ) VALUES (
        ${messageId}, ${tenantId}, ${applicationId}, ${environmentId},
        ${subjectId}, ${contentPiiId}, 'queued', ${STATUS_RANK.queued},
        'sandbox-email', now() - interval '1 hour'
      )`;
    await owner`
      INSERT INTO email_dispatches (message_id, tenant_id)
      VALUES (${messageId}, ${tenantId})`;
    return messageId;
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
    applicationId = seeded.applicationId;
    environmentId = seeded.environmentId;
    await seedManagedEmailDefinition({
      owner,
      tenantId,
      applicationId,
      environmentId,
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
    const config = { get: () => undefined } as unknown as ConfigService;
    email = new EmailService(db, new QueueService(config), vault, {
      isPaused: async (key: string) =>
        key === "platform.email_sending" && emailPaused,
    } as unknown as KillSwitchService);
  });

  afterEach(() => {
    emailPaused = false;
  });

  afterAll(async () => {
    await app?.close();
    await cleanManagedTenant(owner, tenantId);
    await Promise.all([owner.end(), db.end()]);
  });

  it("rechecks the kill-switch before provider contact and refunds managed email", async () => {
    const before = await customerBalance();
    const messageId = await acceptManaged(
      "blocked@example.test",
      "email-block",
    );
    expect(await customerBalance()).toBe(before - COST);

    emailPaused = true;
    await expect(email.process({ tenantId, messageId })).resolves.toBe(
      "failed",
    );

    expect(await customerBalance()).toBe(before);
    expect(await terminalTxnCount(messageId, "refunded")).toBe(1);
    expect(await state(messageId)).toMatchObject({
      messageStatus: "failed",
      errorCode: "email_sending_paused",
      providerRef: null,
      attemptStatus: "failed",
      attemptError: "email_sending_paused",
      deliveryStatus: "failed",
    });
  });

  it("dispatches normally when the kill-switch is off", async () => {
    const before = await customerBalance();
    const messageId = await acceptManaged("ok@example.test", "email-clean");

    await expect(email.process({ tenantId, messageId })).resolves.toBe(
      "delivered",
    );

    expect(await customerBalance()).toBe(before - COST);
    expect(await terminalTxnCount(messageId, "committed")).toBe(1);
    expect(await state(messageId)).toMatchObject({
      messageStatus: "delivered",
      deliveryStatus: "delivered",
    });
  });

  it("expires and refunds stale managed email without provider contact", async () => {
    const before = await customerBalance();
    const messageId = await acceptManaged("crash@example.test", "email-crash");
    await stale(messageId);

    await expect(
      email.sweepStuck(tenantId, new Date().toISOString()),
    ).resolves.toBe(1);

    expect(await customerBalance()).toBe(before);
    expect(await terminalTxnCount(messageId, "refunded")).toBe(1);
    expect(await state(messageId)).toMatchObject({
      messageStatus: "expired",
      errorCode: "dispatch_expired",
      providerRef: null,
      attemptStatus: "expired",
      attemptError: "dispatch_expired",
      deliveryStatus: "expired",
    });
  });

  it("does not refund a stale managed email twice on a second sweep", async () => {
    const messageId = await acceptManaged(
      "replay@example.test",
      "email-replay",
    );
    await stale(messageId);

    expect(await email.sweepStuck(tenantId, new Date().toISOString())).toBe(1);
    expect(await email.sweepStuck(tenantId, new Date().toISOString())).toBe(0);
    expect(await terminalTxnCount(messageId, "refunded")).toBe(1);
  });

  it("ignores stale direct email because it has no managed attempt row", async () => {
    const messageId = await seedDirectQueuedEmail();

    expect(await email.sweepStuck(tenantId, new Date().toISOString())).toBe(0);
    expect(await state(messageId)).toMatchObject({
      messageStatus: "queued",
      providerRef: null,
      attemptStatus: null,
      deliveryStatus: null,
    });
  });

  it("ignores fresh managed email inside the TTL window", async () => {
    const messageId = await acceptManaged("fresh@example.test", "email-fresh");
    const cutoffIso = new Date(Date.now() - 15 * 60_000).toISOString();

    expect(await email.sweepStuck(tenantId, cutoffIso)).toBe(0);
    expect(await state(messageId)).toMatchObject({
      messageStatus: "queued",
      providerRef: null,
      attemptStatus: "accepted",
      deliveryStatus: "accepted",
    });
  });
});
