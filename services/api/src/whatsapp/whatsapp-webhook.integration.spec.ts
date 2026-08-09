import "reflect-metadata";
import { createHmac, randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import type {
  CanonicalDlr,
  Creds,
  HealthState,
  IncomingRequest,
  NormalizedWhatsAppTemplateMessage,
  ProviderResult,
  RequestContext,
  WhatsAppSenderPlugin,
} from "@app/integrations";
import { MetaCloudProvider } from "@app/integrations";
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
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { EffectivePricingService } from "../pricing/effective-pricing.service.js";
import { effectivePricingStub } from "../testing/effective-pricing.stub.js";
import { whatsappPayload } from "./whatsapp.test-doubles.js";
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;
const WEBHOOK_SECRET = "whatsapp-webhook-secret";
const WEBHOOK_VERIFY_TOKEN = "whatsapp-verify-token";
const WEBHOOK_CREDS: Creds = {
  phone_number_id: "123456789",
  waba_id: "987654321",
  access_token: "test-token",
  app_secret: WEBHOOK_SECRET,
  webhook_verify_token: WEBHOOK_VERIFY_TOKEN,
};

process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.PII_MASTER_KEY = "whatsapp-webhook-pii-key-at-least-32-chars";

describeDb("WhatsApp webhook ingress", () => {
  const owner = postgres(SUPER_URL ?? "", { max: 2 });
  const db = createAppDb(APP_URL ?? "", { max: 2 });
  const tenantId = randomUUID();
  const appId = randomUUID();
  const liveId = randomUUID();
  const keySalt = randomUUID().replace(/-/g, "");
  const liveKey = `sk_live_${keySalt}${"5".repeat(8)}`;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'WhatsApp Webhook', ${`wa-webhook-${tenantId}`})`;
    await owner`
      INSERT INTO applications (id, tenant_id, name, slug)
      VALUES (${appId}, ${tenantId}, 'Primary', 'primary')`;
    await owner`
      INSERT INTO environments (id, tenant_id, application_id, type, status)
      VALUES (${liveId}, ${tenantId}, ${appId}, 'live', 'active')`;
    await owner`
      INSERT INTO api_keys (
        tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
      ) VALUES (
        ${tenantId}, ${appId}, ${liveId}, 'sk_live_wa_webhook',
        ${hashApiKey(liveKey)}, 'live', '["whatsapp:send"]'::jsonb, 'active'
      )`;
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false, rawBody: true },
    );
    Object.assign(app.get(EffectivePricingService), effectivePricingStub());
    Object.assign(app.get(WhatsappRuntimeService), {
      resolve: async () => ({
        provider: new WebhookMetaProvider(),
        creds: WEBHOOK_CREDS,
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
      "pii_vault",
      "dek_keys",
      "data_subjects",
      "ledger_entries",
      "ledger_transactions",
      "ledger_accounts",
      "api_idempotency_keys",
      "api_keys",
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

  it("echoes Meta's webhook challenge only for the stored verify token", async () => {
    const ok = await app.inject({
      method: "GET",
      url: `/webhooks/whatsapp/meta-cloud?hub.mode=subscribe&hub.verify_token=${WEBHOOK_VERIFY_TOKEN}&hub.challenge=challenge-123`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("challenge-123");

    const wrongToken = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp/meta-cloud?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123",
    });
    expect(wrongToken.statusCode).toBe(403);

    const missing = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp/meta-cloud?hub.mode=subscribe",
    });
    expect(missing.statusCode).toBe(403);
  });

  it("verifies raw Meta webhook bytes before ingesting statuses", async () => {
    const messageId = await fundedLiveWebhookMessage("wa-webhook-signed");
    const raw = metaStatusBody(`wamid.${messageId}`, "delivered");
    const response = await postWebhook(raw, signed(raw));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ accepted: true, processed: 1 });

    const [msg] = await owner`
      SELECT status::text FROM whatsapp_messages WHERE id = ${messageId}`;
    expect(msg?.status).toBe("delivered");
  });

  it("rejects tampered or unsigned Meta webhook deliveries", async () => {
    const messageId = await fundedLiveWebhookMessage("wa-webhook-rejects");
    const providerRef = `wamid.${messageId}`;
    const raw = metaStatusBody(providerRef, "delivered");
    const tampered = metaStatusBody(providerRef, "failed");

    expect((await postWebhook(tampered, signed(raw))).statusCode).toBe(401);
    expect((await postWebhook(raw)).statusCode).toBe(401);

    const [msg] = await owner`
      SELECT status::text FROM whatsapp_messages WHERE id = ${messageId}`;
    expect(msg?.status).toBe("accepted");
  });

  it("handles duplicate and out-of-order Meta status deliveries idempotently", async () => {
    const duplicateId = await fundedLiveWebhookMessage("wa-webhook-duplicate");
    const delivered = metaStatusBody(`wamid.${duplicateId}`, "delivered");
    expect((await postWebhook(delivered, signed(delivered))).statusCode).toBe(
      200,
    );
    expect((await postWebhook(delivered, signed(delivered))).statusCode).toBe(
      200,
    );
    const terminal = await owner`
      SELECT count(*)::int AS count FROM ledger_transactions
      WHERE tenant_id = ${tenantId}
        AND reference_id = ${duplicateId}
        AND status IN ('committed', 'refunded')`;
    expect(Number(terminal[0]?.count)).toBe(1);

    const outOfOrderId = await fundedLiveWebhookMessage(
      "wa-webhook-out-of-order",
    );
    const deliveredFirst = metaStatusBody(`wamid.${outOfOrderId}`, "delivered");
    const staleSent = metaStatusBody(`wamid.${outOfOrderId}`, "sent");
    expect(
      (await postWebhook(deliveredFirst, signed(deliveredFirst))).statusCode,
    ).toBe(200);
    expect((await postWebhook(staleSent, signed(staleSent))).statusCode).toBe(
      200,
    );

    const [msg] = await owner`
      SELECT status::text FROM whatsapp_messages WHERE id = ${outOfOrderId}`;
    expect(msg?.status).toBe("delivered");
  });

  async function fundedLiveWebhookMessage(idempotencyKey: string) {
    await db.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 10_000n,
        idempotencyKey: `topup:${idempotencyKey}`,
      }),
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/messages",
      headers: {
        authorization: `Bearer ${liveKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: whatsappPayload(),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; status: string };
    expect(body.status).toBe("accepted");
    return body.id;
  }

  function postWebhook(raw: string, signature?: string) {
    return app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/meta-cloud",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-hub-signature-256": signature } : {}),
      },
      payload: raw,
    });
  }
});

class WebhookMetaProvider implements WhatsAppSenderPlugin {
  private readonly meta = new MetaCloudProvider();
  readonly slug = "meta-cloud";
  readonly capability = "whatsapp" as const;
  readonly version = "0.1.0";
  readonly billableStatuses = ["accepted"] as const;
  readonly configSchema = {};

  supports(_context: RequestContext): boolean {
    return true;
  }

  healthCheck(): Promise<HealthState> {
    return Promise.resolve({ status: "up" });
  }

  send(
    message: NormalizedWhatsAppTemplateMessage,
    _creds: Creds,
  ): Promise<ProviderResult> {
    return Promise.resolve({
      status: "accepted",
      providerRef: `wamid.${message.messageId}`,
      raw: { fake: true },
    });
  }

  verifyWebhook(request: IncomingRequest, creds: Creds): boolean {
    return this.meta.verifyWebhook(request, creds);
  }

  parseDlr(payload: unknown): CanonicalDlr {
    return this.meta.parseDlr(payload);
  }
}

function signed(rawBody: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("hex")}`;
}

function metaStatusBody(providerRef: string, status: string): string {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id: providerRef, status, timestamp: "1723123456" }],
            },
          },
        ],
      },
    ],
  });
}
