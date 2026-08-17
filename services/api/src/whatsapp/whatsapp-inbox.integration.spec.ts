import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { unwrapEnvelope } from "@app/contracts";
import { createAppDb } from "@app/db";
import { FakeWhatsAppProvider } from "@app/integrations/testing/whatsapp";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { whatsappPayload } from "./whatsapp.test-doubles.js";
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;
process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.PII_MASTER_KEY =
  "whatsapp-inbox-integration-pii-key-at-least-32-chars";
process.env.BFF_INTERNAL_TOKEN = "test-bff-token";

describeDb("internal WhatsApp dashboard API", () => {
  const owner = postgres(SUPER_URL ?? "", { max: 2 });
  const db = createAppDb(APP_URL ?? "", { max: 2 });
  const tenantId = randomUUID();
  const appId = randomUUID();
  const sandboxId = randomUUID();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'WhatsApp Inbox API', ${`wa-inbox-${tenantId}`})`;
    await owner`
      INSERT INTO applications (id, tenant_id, name, slug)
      VALUES (${appId}, ${tenantId}, 'Primary', 'primary')`;
    await owner`
      INSERT INTO environments (id, tenant_id, application_id, type, status)
      VALUES (${sandboxId}, ${tenantId}, ${appId}, 'sandbox', 'active')`;
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false, rawBody: true },
    );
    Object.assign(app.get(WhatsappRuntimeService), {
      resolve: async () => ({
        provider: new FakeWhatsAppProvider(),
        creds: {},
      }),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get(KillSwitchService).list();
  });

  afterAll(async () => {
    await app?.close();
    for (const table of [
      "whatsapp_dispatches",
      "outbox_events",
      "whatsapp_messages",
      "sandbox_usage_events",
      "sandbox_usage_buckets",
      "pii_vault",
      "dek_keys",
      "data_subjects",
      "api_idempotency_keys",
    ]) {
      await owner.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [
        tenantId,
      ]);
    }
    await owner`DELETE FROM applications WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await owner.end();
    await db.end();
  });

  it("sends and lists WhatsApp through BFF-token tenant environment resolution", async () => {
    const request = {
      method: "POST" as const,
      url: `/internal/tenants/${tenantId}/whatsapp?env=sandbox`,
      headers: {
        "x-bff-token": "test-bff-token",
        "content-type": "application/json",
        "idempotency-key": "wa-dashboard-1",
      },
      payload: whatsappPayload(),
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);
    expect(first.statusCode, JSON.stringify(unwrapEnvelope(first.json()))).toBe(
      201,
    );
    expect(replay.statusCode).toBe(201);
    const body = unwrapEnvelope(first.json()) as {
      id: string;
      to: string;
      cost: { minor: string; currency: string };
    };
    expect(body.to).not.toContain("+233545227189");
    expect(body.cost).toEqual({ minor: "0", currency: "GHS" });
    expect((unwrapEnvelope(replay.json()) as { id: string }).id).toBe(body.id);

    const persisted = await owner`
      SELECT application_id, environment_id
      FROM whatsapp_messages
      WHERE id = ${body.id}`;
    expect(String(persisted[0]?.application_id)).toBe(appId);
    expect(String(persisted[0]?.environment_id)).toBe(sandboxId);

    const list = await app.inject({
      method: "GET",
      url: `/internal/tenants/${tenantId}/whatsapp?env=sandbox`,
      headers: { "x-bff-token": "test-bff-token" },
    });
    expect(list.statusCode).toBe(200);
    const listed = unwrapEnvelope(list.json()) as {
      messages: Array<{
        id: string;
        to: string;
        template_name: string | null;
        cost: { minor: string; currency: string };
      }>;
    };
    expect(listed.messages).toContainEqual(
      expect.objectContaining({
        id: body.id,
        to: body.to,
        template_name: whatsappPayload().template_name,
        cost: { minor: "0", currency: "GHS" },
      }),
    );
    expect(JSON.stringify(listed)).not.toContain("+233545227189");
  });

  it("rejects dashboard WhatsApp calls without the BFF token", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/internal/tenants/${tenantId}/whatsapp?env=sandbox`,
    });
    expect(response.statusCode).toBe(401);
    expect(unwrapEnvelope(response.json())).toMatchObject({
      error: { code: "invalid_bff_token" },
    });
  });
});
