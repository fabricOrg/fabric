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
  WhatsAppTemplateRecord,
} from "@app/integrations";
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
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";
import { WhatsappTemplateSyncScheduler } from "./whatsapp-template-sync.scheduler.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;
const WEBHOOK_SECRET = "whatsapp-template-webhook-secret";
const WABA_ID = "987654321";
const CREDS: Creds = {
  phone_number_id: "123456789",
  waba_id: WABA_ID,
  access_token: "test-token",
  app_secret: WEBHOOK_SECRET,
  webhook_verify_token: "verify-token",
};

process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.PII_MASTER_KEY = "whatsapp-template-pii-key-at-least-32-chars";

describeDb("WhatsApp template lifecycle", () => {
  const owner = postgres(SUPER_URL ?? "", { max: 2 });
  const db = createAppDb(APP_URL ?? "", { max: 2 });
  const tenantId = randomUUID();
  const appId = randomUUID();
  const liveId = randomUUID();
  const keySalt = randomUUID().replace(/-/g, "");
  const liveKey = `sk_live_${keySalt}${"7".repeat(8)}`;
  const provider = new LifecycleProvider();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'WhatsApp Templates', ${`wa-tpl-${tenantId}`})`;
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
        ${tenantId}, ${appId}, ${liveId}, 'sk_live_wa_templates',
        ${hashApiKey(liveKey)}, 'live', '["whatsapp:send"]'::jsonb, 'active'
      )`;
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false, rawBody: true },
    );
    Object.assign(app.get(EffectivePricingService), effectivePricingStub());
    Object.assign(app.get(WhatsappRuntimeService), {
      resolve: async () => ({ provider, creds: CREDS }),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get(KillSwitchService).list();
    await fund("templates-initial");
  });

  afterAll(async () => {
    await app?.close();
    for (const table of [
      "whatsapp_dispatches",
      "outbox_events",
      "whatsapp_messages",
      "whatsapp_templates",
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

  it("syncs templates through the scheduled caller and is idempotent", async () => {
    const seed = await send("order_update", "wa-template-seed");
    expect(seed.statusCode).toBe(201);

    const scheduler = app.get(WhatsappTemplateSyncScheduler);
    await expect(scheduler.run({ tenantIds: [tenantId] })).resolves.toEqual({
      locked: true,
      synced: 2,
    });
    await expect(scheduler.run({ tenantIds: [tenantId] })).resolves.toEqual({
      locked: true,
      synced: 2,
    });

    const rows = await owner`
      SELECT name, language, status, quality_rating
      FROM whatsapp_templates
      WHERE tenant_id = ${tenantId}
      ORDER BY name`;
    expect(rows).toMatchObject([
      { name: "order_update", language: "en", status: "APPROVED" },
      { name: "promo", language: "en", status: "PAUSED" },
    ]);
    const count = await owner`
      SELECT count(*)::int AS count FROM whatsapp_templates
      WHERE tenant_id = ${tenantId}`;
    expect(Number(count[0]?.count)).toBe(2);
  });

  it("applies a status webhook downgrade and blocks the next send with a stable code", async () => {
    const raw = templateStatusBody("PAUSED", 1_800_000_000);
    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/meta-cloud",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signed(raw),
      },
      payload: raw,
    });
    expect(webhook.statusCode).toBe(200);

    const blocked = await send("order_update", "wa-template-paused");
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({
      error: { code: "whatsapp_template_paused" },
    });
  });

  it("does not let duplicate or out-of-order template events regress newer state", async () => {
    const rejected = templateStatusBody("REJECTED", 1_800_000_100);
    const staleApproved = templateStatusBody("APPROVED", 1_800_000_000);
    expect((await postWebhook(rejected)).statusCode).toBe(200);
    expect((await postWebhook(rejected)).statusCode).toBe(200);
    expect((await postWebhook(staleApproved)).statusCode).toBe(200);

    const row = await owner`
      SELECT status::text FROM whatsapp_templates
      WHERE tenant_id = ${tenantId}
        AND waba_id = ${WABA_ID}
        AND name = 'order_update'
        AND language = 'en'`;
    expect(row[0]?.status).toBe("REJECTED");
  });

  it("fails open when the template cache is stale", async () => {
    await owner`
      UPDATE whatsapp_templates
      SET synced_at = now() - interval '3 hours'
      WHERE tenant_id = ${tenantId} AND waba_id = ${WABA_ID}`;
    const response = await send(
      "unknown_but_provider_accepts",
      "wa-stale-open",
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: "accepted" });
  });

  async function fund(key: string): Promise<void> {
    await db.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 10_000n,
        idempotencyKey: `topup:${key}`,
      }),
    );
  }

  function send(templateName: string, idempotencyKey: string) {
    return app.inject({
      method: "POST",
      url: "/v1/whatsapp/messages",
      headers: {
        authorization: `Bearer ${liveKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: {
        to: "+233545227189",
        template_name: templateName,
        template_language: "en",
        template_category: "utility",
        variables: ["A123"],
        currency: "GHS",
      },
    });
  }

  function postWebhook(raw: string) {
    return app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/meta-cloud",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signed(raw),
      },
      payload: raw,
    });
  }
});

class LifecycleProvider implements WhatsAppSenderPlugin {
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

  parseDlr(_payload: unknown): CanonicalDlr {
    return { providerRef: "unused", status: "delivered" };
  }

  verifyWebhook(request: IncomingRequest, creds: Creds): boolean {
    const provided = request.headers["x-hub-signature-256"];
    if (!provided) return false;
    const hmac = createHmac("sha256", creds.app_secret ?? "");
    if (typeof request.rawBody === "string") {
      hmac.update(request.rawBody, "utf8");
    } else {
      hmac.update(request.rawBody);
    }
    return provided === `sha256=${hmac.digest("hex")}`;
  }

  listTemplates(_creds: Creds): Promise<readonly WhatsAppTemplateRecord[]> {
    return Promise.resolve([
      {
        wabaId: WABA_ID,
        name: "order_update",
        language: "en",
        category: "UTILITY",
        status: "APPROVED",
        qualityRating: "GREEN",
        components: [{ type: "BODY", text: "Hello {{1}}" }],
      },
      {
        wabaId: WABA_ID,
        name: "promo",
        language: "en",
        category: "MARKETING",
        status: "PAUSED",
        qualityRating: "YELLOW",
        components: [],
      },
    ]);
  }
}

function signed(rawBody: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("hex")}`;
}

function templateStatusBody(status: string, timestamp: number): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: status,
              message_template_name: "order_update",
              message_template_language: "en",
              timestamp,
            },
          },
        ],
      },
    ],
  });
}
