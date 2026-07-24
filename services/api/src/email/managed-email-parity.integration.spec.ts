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
import { PiiVaultService } from "../privacy/pii-vault.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.TENANT_TOKEN_SECRET ??= "integration-test-tenant-token-secret";

describeDb("SDK-007 managed email preview/send parity", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");
  const tenantId = randomUUID();
  const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  let app: NestFastifyApplication;
  let vault: PiiVaultService;

  const payload = {
    key: "order.email",
    to: "ada@example.test",
    data: { name: "<b>Ada & Co</b>", count: 2 },
    currency: "GHS",
  };

  function authHeaders(idempotencyKey?: string) {
    return {
      authorization: `Bearer ${rawKey}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    };
  }

  async function storedEmailContent(deliveryId: string) {
    const rows = await db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT content_pii_id FROM email_messages WHERE id = ${deliveryId}`,
    );
    const piiId = String(rows[0]?.content_pii_id ?? "");
    if (!piiId) throw new Error("email content pii id missing");
    const raw = await vault.read(tenantId, piiId);
    if (!raw) throw new Error("email content unreadable");
    return JSON.parse(raw) as {
      subject: string;
      text?: string;
      html?: string;
    };
  }

  async function deliveryMoney(deliveryId: string) {
    const rows = await db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT d.total_cost_minor, a.cost_minor
        FROM message_deliveries d
        JOIN message_delivery_attempts a ON a.delivery_id = d.id
        WHERE d.id = ${deliveryId}`,
    );
    const row = rows[0];
    if (!row) throw new Error("delivery money rows missing");
    return {
      totalCostMinor: String(row.total_cost_minor),
      attemptCostMinor: String(row.cost_minor),
    };
  }

  async function reserveAmount(deliveryId: string): Promise<bigint> {
    const rows = await db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT COALESCE(sum(e.amount_minor), 0)::bigint AS amount
        FROM ledger_entries e
        JOIN ledger_accounts a ON a.id = e.account_id
        WHERE e.reference_id = ${deliveryId}
          AND e.reason = 'message_reserve'
          AND e.direction = 'credit'
          AND a.kind = 'reserved_clearing'`,
    );
    return BigInt(String(rows[0]?.amount ?? "0"));
  }

  async function raceCounts(deliveryId: string, idempotencyKey: string) {
    return db.withTenant(tenantId, async (tx) => {
      const deliveries = await tx`
        SELECT count(*)::int AS n FROM message_deliveries
        WHERE idempotency_key = ${idempotencyKey}`;
      const attempts = await tx`
        SELECT count(*)::int AS n FROM message_delivery_attempts
        WHERE delivery_id = ${deliveryId}`;
      const emailMessages = await tx`
        SELECT count(*)::int AS n FROM email_messages WHERE id = ${deliveryId}`;
      const reserves = await tx`
        SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key = ${`reserve:${deliveryId}`}`;
      return {
        deliveries: Number(deliveries[0]?.n ?? 0),
        attempts: Number(attempts[0]?.n ?? 0),
        emailMessages: Number(emailMessages[0]?.n ?? 0),
        reserves: Number(reserves[0]?.n ?? 0),
      };
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = appUrl;
    const seeded = await seedManagedTenant({
      owner,
      db,
      tenantId,
      rawKey,
      scopes: ["messages:send", "messages:read", "sms:read"],
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
    vault = app.get(PiiVaultService);
  });

  afterAll(async () => {
    await app?.close();
    await cleanManagedTenant(owner, tenantId);
    await Promise.all([owner.end(), db.end()]);
  });

  it("stores byte-identical rendered content and reserves the preview price", async () => {
    const previewResponse = await app.inject({
      method: "POST",
      url: "/v1/messages/preview",
      headers: authHeaders(),
      payload: {
        key: payload.key,
        data: payload.data,
        currency: payload.currency,
      },
    });
    expect(previewResponse.statusCode).toBe(201);
    const preview = (
      previewResponse.json() as {
        email_preview: {
          subject: string;
          text: string;
          html: string;
          cost_minor: string;
          currency: string;
        };
      }
    ).email_preview;

    const sendResponse = await app.inject({
      method: "POST",
      url: "/v1/message-deliveries",
      headers: authHeaders("email-parity"),
      payload,
    });
    expect(sendResponse.statusCode).toBe(202);
    const deliveryId = (sendResponse.json() as { delivery: { id: string } })
      .delivery.id;

    await expect(storedEmailContent(deliveryId)).resolves.toMatchObject({
      subject: preview.subject,
      text: preview.text,
      html: preview.html,
    });
    expect(preview.html).toBe("<p>Hi &lt;b&gt;Ada &amp; Co&lt;/b&gt;</p>");
    expect(await reserveAmount(deliveryId)).toBe(BigInt(preview.cost_minor));
    expect(await deliveryMoney(deliveryId)).toEqual({
      totalCostMinor: preview.cost_minor,
      attemptCostMinor: preview.cost_minor,
    });
    expect(preview.currency).toBe("GHS");
  });

  it("collapses concurrent identical email sends onto one reserve", async () => {
    const key = "email-concurrent";
    const [a, b, c] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/message-deliveries",
        headers: authHeaders(key),
        payload: { ...payload, to: "race@example.test" },
      }),
      app.inject({
        method: "POST",
        url: "/v1/message-deliveries",
        headers: authHeaders(key),
        payload: { ...payload, to: "race@example.test" },
      }),
      app.inject({
        method: "POST",
        url: "/v1/message-deliveries",
        headers: authHeaders(key),
        payload: { ...payload, to: "race@example.test" },
      }),
    ]);

    for (const response of [a, b, c]) expect(response.statusCode).toBe(202);
    const ids = new Set(
      [a, b, c].map(
        (response) =>
          (response.json() as { delivery: { id: string } }).delivery.id,
      ),
    );
    expect(ids.size).toBe(1);
    const deliveryId = [...ids][0] ?? "";
    expect(await raceCounts(deliveryId, key)).toEqual({
      deliveries: 1,
      attempts: 1,
      emailMessages: 1,
      reserves: 1,
    });
    expect(await reserveAmount(deliveryId)).toBe(5n);
  });
});
