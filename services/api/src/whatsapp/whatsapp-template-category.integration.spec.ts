import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import type {
  CanonicalDlr,
  Creds,
  HealthState,
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

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;
const WEBHOOK_SECRET = "whatsapp-category-webhook-secret";
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
process.env.PII_MASTER_KEY = "whatsapp-category-pii-key-at-least-32-chars";

describeDb("WhatsApp template category enforcement", () => {
  const owner = postgres(SUPER_URL ?? "", { max: 2 });
  const db = createAppDb(APP_URL ?? "", { max: 2 });
  const tenantId = randomUUID();
  const appId = randomUUID();
  const liveId = randomUUID();
  const keySalt = randomUUID().replace(/-/g, "");
  const liveKey = `sk_live_${keySalt}${"8".repeat(8)}`;
  const provider = new CategoryProvider();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'WhatsApp Category', ${`wa-cat-${tenantId}`})`;
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
        ${tenantId}, ${appId}, ${liveId}, 'sk_live_wa_category',
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
    await db.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 100_000n,
        idempotencyKey: `topup:${tenantId}`,
      }),
    );
    // A FRESH cache row is the precondition: the check deliberately fails open on staleness, so a
    // stale row would make these tests pass for the wrong reason.
    await owner`
      INSERT INTO whatsapp_templates (
        tenant_id, waba_id, name, language, category, status, components,
        synced_at, status_updated_at, quality_updated_at, category_updated_at
      ) VALUES (
        ${tenantId}, ${WABA_ID}, 'order_update', 'en', 'MARKETING', 'APPROVED',
        ${owner.json([{ type: "BODY", text: "Order {{1}}" }])}::jsonb,
        now(), now(), now(), now()
      )`;
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
    await Promise.all([owner.end(), db.end()]);
  });

  it("refuses a claimed category Meta disagrees with", async () => {
    // The category never reaches Meta. It drives OUR consent gate and OUR pricing traffic class, so a
    // caller claiming `utility` for a template Meta approved as MARKETING skips BOTH promotional
    // checks — consent suppression and the marketing delivery window — and bills the wrong class.
    // Rejected rather than silently overridden: overriding changes what someone is charged without
    // telling them, and the correct value is knowable, so the error can name it.
    await owner`
      UPDATE whatsapp_templates
      SET status = 'APPROVED', category = 'MARKETING', synced_at = now()
      WHERE tenant_id = ${tenantId} AND waba_id = ${WABA_ID}
        AND name = 'order_update' AND language = 'en'`;

    const mismatched = await send("order_update", "wa-cat-mismatch", "utility");
    expect(mismatched.statusCode).toBe(400);
    const body = mismatched.json() as {
      error: { code: string; message: string; param?: string };
    };
    expect(body.error).toMatchObject({
      code: "whatsapp_template_category_mismatch",
      param: "template_category",
    });
    // The error names the real category, so a caller can fix it without guessing.
    expect(body.error.message).toContain("marketing");
  });

  it("accepts a claim that matches, without inventing a new refusal", async () => {
    // AUTHENTICATION rather than MARKETING on purpose. A matching `marketing` claim is still refused
    // here — by the promotional delivery-window rule, which is a DIFFERENT and correct gate — so
    // asserting 201 on marketing would be asserting that gate away. Authentication is non-promotional,
    // which isolates the property under test: a matching category adds no refusal of its own.
    await owner`
      UPDATE whatsapp_templates
      SET status = 'APPROVED', category = 'AUTHENTICATION', synced_at = now()
      WHERE tenant_id = ${tenantId} AND waba_id = ${WABA_ID}
        AND name = 'order_update' AND language = 'en'`;
    const response = await send("order_update", "wa-cat-ok", "authentication");
    expect(response.statusCode).toBe(201);

    const wrong = await send("order_update", "wa-cat-wrong", "utility");
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({
      error: { code: "whatsapp_template_category_mismatch" },
    });
  });

  it("does not invent a category Meta never reported", async () => {
    // An unmapped or absent category means we do not know the class. We cannot then claim to know
    // better than the caller, so the send proceeds — the alternative is refusing every template whose
    // category Meta omitted, which is a channel outage caused by a missing field.
    await owner`
      UPDATE whatsapp_templates
      SET status = 'APPROVED', category = NULL, synced_at = now()
      WHERE tenant_id = ${tenantId} AND waba_id = ${WABA_ID}
        AND name = 'order_update' AND language = 'en'`;
    const response = await send("order_update", "wa-cat-null", "utility");
    expect(response.statusCode).toBe(201);
  });

  function send(
    templateName: string,
    idempotencyKey: string,
    templateCategory: "utility" | "marketing" | "authentication",
  ) {
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
        template_category: templateCategory,
        variables: ["A123"],
        currency: "GHS",
      },
    });
  }
});

class CategoryProvider implements WhatsAppSenderPlugin {
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
    });
  }

  verifyWebhook(): boolean {
    return true;
  }

  parseDlr(): CanonicalDlr {
    return { providerRef: "", status: "accepted" };
  }

  listTemplates(_creds: Creds): Promise<readonly WhatsAppTemplateRecord[]> {
    return Promise.resolve([]);
  }
}
