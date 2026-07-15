import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "../api-keys/api-key.crypto.js";
import { AppModule } from "../app.module.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";

describeDb("public Email API", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const tenantId = randomUUID();
  const appId = randomUUID();
  const sandboxId = randomUUID();
  const liveId = randomUUID();
  const otherAppId = randomUUID();
  const otherSandboxId = randomUUID();
  const sandboxKey = `sk_test_${"1".repeat(40)}`;
  const liveKey = `sk_live_${"2".repeat(40)}`;
  const otherKey = `sk_test_${"3".repeat(40)}`;
  let app: NestFastifyApplication;
  let messageId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = appUrl;
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'Email API', ${`email-${tenantId}`})`;
    await owner`
      INSERT INTO applications (id, tenant_id, name, slug) VALUES
        (${appId}, ${tenantId}, 'Primary', 'primary'),
        (${otherAppId}, ${tenantId}, 'Other', 'other')`;
    await owner`
      INSERT INTO environments (id, tenant_id, application_id, type, status) VALUES
        (${sandboxId}, ${tenantId}, ${appId}, 'sandbox', 'active'),
        (${liveId}, ${tenantId}, ${appId}, 'live', 'active'),
        (${otherSandboxId}, ${tenantId}, ${otherAppId}, 'sandbox', 'active')`;
    await owner`
      INSERT INTO api_keys (
        tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
      ) VALUES
        (${tenantId}, ${appId}, ${sandboxId}, 'sk_test_email',
         ${hashApiKey(sandboxKey)}, 'test', '["email:send","email:read"]'::jsonb, 'active'),
        (${tenantId}, ${appId}, ${liveId}, 'sk_live_email',
         ${hashApiKey(liveKey)}, 'live', '["email:send","email:read"]'::jsonb, 'active'),
        (${tenantId}, ${otherAppId}, ${otherSandboxId}, 'sk_test_other_email',
         ${hashApiKey(otherKey)}, 'test', '["email:read"]'::jsonb, 'active')`;
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
    await owner`DELETE FROM email_messages WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM api_keys WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM applications WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await owner.end();
  });

  it("sends a sandbox email idempotently and persists a terminal result", async () => {
    const request = {
      method: "POST" as const,
      url: "/v1/email/messages",
      headers: {
        authorization: `Bearer ${sandboxKey}`,
        "content-type": "application/json",
        "idempotency-key": "welcome-email-1",
      },
      payload: {
        to: "recipient@example.com",
        from: "hello@merchant.example",
        subject: "Welcome",
        text: "Your sandbox email works.",
      },
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    const response = first.json() as {
      id: string;
      status: string;
      request_id: string;
    };
    messageId = response.id;
    expect(response.status).toBe("delivered");
    expect(response.request_id).toMatch(/^req_/);
    expect((replay.json() as { id: string }).id).toBe(messageId);

    const rows = await owner`
      SELECT count(*)::int AS count FROM email_messages
      WHERE tenant_id = ${tenantId}`;
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("retrieves and lists only within the presenting application environment", async () => {
    const primaryHeaders = { authorization: `Bearer ${sandboxKey}` };
    const detail = await app.inject({
      method: "GET",
      url: `/v1/email/messages/${messageId}`,
      headers: primaryHeaders,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      message: {
        id: messageId,
        to: "recipient@example.com",
        subject: "Welcome",
        status: "delivered",
      },
    });

    const other = await app.inject({
      method: "GET",
      url: `/v1/email/messages/${messageId}`,
      headers: { authorization: `Bearer ${otherKey}` },
    });
    expect(other.statusCode).toBe(404);
  });

  it("stores recipient and content only as encrypted vault data", async () => {
    const rows = await owner`
      SELECT s.email_hash, v.ciphertext::text AS ciphertext
      FROM email_messages m
      JOIN data_subjects s ON s.subject_id = m.subject_id
      JOIN pii_vault v ON v.id = m.content_pii_id
      WHERE m.id = ${messageId}`;
    expect(String(rows[0]?.email_hash)).not.toContain("recipient@example.com");
    expect(String(rows[0]?.ciphertext)).not.toContain("Welcome");
  });

  it("emits application-scoped created and updated outbox events", async () => {
    const events = await owner`
      SELECT event_type, application_id, environment_id, payload
      FROM outbox_events WHERE tenant_id = ${tenantId}
      ORDER BY created_at`;
    expect(events.map((event) => event.event_type)).toEqual([
      "message.created",
      "message.updated",
    ]);
    for (const event of events) {
      expect(String(event.application_id)).toBe(appId);
      expect(String(event.environment_id)).toBe(sandboxId);
      expect(event.payload).toMatchObject({ channel: "email" });
    }
  });

  it("fails closed for live Email until domain and provider prerequisites exist", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/email/messages",
      headers: {
        authorization: `Bearer ${liveKey}`,
        "content-type": "application/json",
      },
      payload: {
        to: "recipient@example.com",
        from: "hello@merchant.example",
        subject: "No live bypass",
        text: "This must not leave Fabric.",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "live_email_not_configured" },
    });
  });
});
