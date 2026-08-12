import "reflect-metadata";
import { createHmac, randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import type { Creds } from "@app/integrations";
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
import { WhatsappLifecycleProvider } from "../testing/whatsapp-lifecycle.provider.js";
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
  const sharedWabaTenantId = randomUUID(); // 2nd workspace, SAME WABA (ADR-0015 §2 aggregator model)
  const bootstrapTenantId = randomUUID(); // has a live environment and nothing else
  const bootstrapAppId = randomUUID();
  const appId = randomUUID();
  const liveId = randomUUID();
  const keySalt = randomUUID().replace(/-/g, "");
  const liveKey = `sk_live_${keySalt}${"7".repeat(8)}`;
  const provider = new WhatsappLifecycleProvider(WABA_ID);
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug) VALUES
        (${tenantId}, 'WhatsApp Templates', ${`wa-tpl-${tenantId}`}),
        (${sharedWabaTenantId}, 'Shared WABA', ${`wa-shared-${sharedWabaTenantId}`})`;
    // A workspace with an active LIVE environment and nothing else: no templates, no messages. This
    // is the state a freshly promoted environment is in.
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${bootstrapTenantId}, 'Bootstrap', ${`wa-boot-${bootstrapTenantId}`})`;
    await owner`
      INSERT INTO applications (id, tenant_id, name, slug)
      VALUES (${bootstrapAppId}, ${bootstrapTenantId}, 'Primary', 'primary')`;
    await owner`
      INSERT INTO environments (id, tenant_id, application_id, type, status)
      VALUES (${randomUUID()}, ${bootstrapTenantId}, ${bootstrapAppId}, 'live', 'active')`;
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
    await owner`DELETE FROM whatsapp_templates WHERE tenant_id IN (${sharedWabaTenantId}, ${bootstrapTenantId})`;
    await owner`DELETE FROM environments WHERE tenant_id = ${bootstrapTenantId}`;
    await owner`DELETE FROM applications WHERE tenant_id = ${bootstrapTenantId}`;
    await owner`DELETE FROM accounts WHERE id IN (${tenantId}, ${sharedWabaTenantId}, ${bootstrapTenantId})`;
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

  // Regression for 0150: keyed on waba_id alone the sync upsert reassigned tenant_id, so the second
  // workspace to sync TOOK the first one's rows. Normal path, not a race — one tick loops every
  // tenant on the WABA. Two owners of two rows each; the defect left one owner holding all of them.
  it("keeps each workspace's templates when two share one WABA", async () => {
    const scheduler = app.get(WhatsappTemplateSyncScheduler);
    await scheduler.run({ tenantIds: [tenantId] });
    // Asserted, not awaited bare: the scheduler catches per-tenant failures and only warns, so a
    // missing ON CONFLICT target would otherwise surface as a puzzling count instead of its own error.
    await expect(
      scheduler.run({ tenantIds: [sharedWabaTenantId] }),
    ).resolves.toEqual({ locked: true, synced: 2 });
    const rows = await owner`
      SELECT tenant_id, count(*)::int AS n FROM whatsapp_templates
      WHERE waba_id = ${WABA_ID} AND tenant_id IN (${tenantId}, ${sharedWabaTenantId})
      GROUP BY tenant_id ORDER BY tenant_id`;
    expect(rows.map((row) => Number(row.n))).toEqual([2, 2]);
  });

  // Bootstrap: the scheduler used to find tenants only by "already holds a template row" or "already
  // sent a non-sandbox message", so a workspace that had done neither could never get a FIRST sync and
  // its picker stayed empty forever. That is the state a freshly promoted environment is in. An active
  // live environment is now enough to be discovered.
  it("discovers a workspace that has never synced or sent", async () => {
    const scheduler = app.get(WhatsappTemplateSyncScheduler);
    const [before] = await owner`
      SELECT count(*)::int AS n FROM whatsapp_templates
      WHERE tenant_id = ${bootstrapTenantId}`;
    expect(Number(before?.n)).toBe(0);

    const discovered = await scheduler.run();
    expect(discovered.locked).toBe(true);

    const [after] = await owner`
      SELECT count(*)::int AS n FROM whatsapp_templates
      WHERE tenant_id = ${bootstrapTenantId}`;
    expect(Number(after?.n)).toBe(2);
  });

  // A template webhook carries a status, never components. An event for a template nobody has cached
  // used to INVENT a row per tenant — status UNKNOWN, components [], synced_at stamped from the event
  // — which made latestSync() look fresh and flipped those tenants' other sends from fail-open to a
  // hard 400. Both tenants above are in the WABA's tenant list by now, so this is not vacuous: before
  // the fix it created two rows.
  it("invents no cache row for a template nobody has synced", async () => {
    const raw = templateStatusBody("APPROVED", 1_900_000_000, "never_synced");
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
    // Scoped to this spec's own tenants, NOT a global count. applyWebhookEvent fans out to every
    // tenant on the WABA, so on a developer database that holds real workspaces the `processed` total
    // and a global row count both depend on data this spec did not create.
    const rows = await owner`
      SELECT count(*)::int AS n FROM whatsapp_templates
      WHERE name = 'never_synced' AND tenant_id IN (${tenantId}, ${sharedWabaTenantId})`;
    expect(Number(rows[0]?.n)).toBe(0);
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

  function send(
    templateName: string,
    idempotencyKey: string,
    templateCategory: "utility" | "marketing" | "authentication" = "utility",
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

function signed(rawBody: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("hex")}`;
}

function templateStatusBody(
  status: string,
  timestamp: number,
  name = "order_update",
): string {
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
              message_template_name: name,
              message_template_language: "en",
              timestamp,
            },
          },
        ],
      },
    ],
  });
}
