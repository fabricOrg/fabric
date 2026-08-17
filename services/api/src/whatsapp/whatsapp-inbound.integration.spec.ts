import "reflect-metadata";
import { createHmac, randomUUID } from "node:crypto";
import { unwrapEnvelope } from "@app/contracts";
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
import { MetaWebhookProvider } from "./whatsapp.test-doubles.js";
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;
const WEBHOOK_SECRET = "whatsapp-inbound-secret";
const PHONE_NUMBER_ID = "555000111";
const CREDS: Creds = {
  phone_number_id: PHONE_NUMBER_ID,
  waba_id: "555000222",
  access_token: "test-token",
  app_secret: WEBHOOK_SECRET,
  webhook_verify_token: "inbound-verify-token",
};

process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.PII_MASTER_KEY = "whatsapp-inbound-pii-key-at-least-32-chars";

/**
 * WhatsApp inbound + the service window (ADR-0015). The property under test is ATTRIBUTION, which is
 * the only genuinely hard part: Meta's payload never says which tenant an inbound belongs to, so the
 * rule is "whoever last messaged that consumer inside the window" — including the case where two
 * tenants did, and the case where nobody did.
 */
describeDb("WhatsApp inbound and the customer service window", () => {
  const owner = postgres(SUPER_URL ?? "", { max: 3 });
  const db = createAppDb(APP_URL ?? "", { max: 3 });
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const keySalt = randomUUID().replace(/-/g, "");
  const keyA = `sk_live_${keySalt}${"1".repeat(8)}`;
  const keyB = `sk_live_${keySalt}${"2".repeat(8)}`;
  const CONSUMER = "+233545227189";
  const STRANGER = "+233545227000";
  let app: NestFastifyApplication;

  async function seedTenant(tenantId: string, rawKey: string, label: string) {
    const appId = randomUUID();
    const envId = randomUUID();
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, ${label}, ${`${label}-${tenantId}`})`;
    await owner`
      INSERT INTO applications (id, tenant_id, name, slug)
      VALUES (${appId}, ${tenantId}, 'Primary', 'primary')`;
    await owner`
      INSERT INTO environments (id, tenant_id, application_id, type, status)
      VALUES (${envId}, ${tenantId}, ${appId}, 'live', 'active')`;
    await owner`
      INSERT INTO api_keys (
        tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
      ) VALUES (
        ${tenantId}, ${appId}, ${envId}, ${`sk_live_${label}`},
        ${hashApiKey(rawKey)}, 'live', '["whatsapp:send"]'::jsonb, 'active'
      )`;
    await db.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 100_000n,
        idempotencyKey: `topup:${tenantId}`,
      }),
    );
    return { appId, envId };
  }

  /** A real outbound through the public API — attribution reads what a live send actually wrote. */
  async function sendTo(rawKey: string, to: string, idempotencyKey: string) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/messages",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: {
        to,
        template_name: "order_update",
        template_language: "en",
        template_category: "utility",
        variables: ["A123"],
        currency: "GHS",
      },
    });
    expect(response.statusCode).toBe(201);
    return (unwrapEnvelope(response.json()) as { id: string }).id;
  }

  function postInbound(from: string, wamid: string, type = "text") {
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  {
                    id: wamid,
                    // Meta reports `from` WITHOUT a leading `+`.
                    from: from.replace("+", ""),
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type,
                    text: { body: "is my order out for delivery?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    return app.inject({
      method: "POST",
      url: "/webhooks/whatsapp/meta-cloud",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", WEBHOOK_SECRET)
          .update(raw, "utf8")
          .digest("hex")}`,
      },
      payload: raw,
    });
  }

  async function inboundRows(tenantId: string) {
    return owner`
      SELECT id, tenant_id, provider_ref, message_type, content_pii_id
      FROM whatsapp_inbound_messages WHERE tenant_id = ${tenantId}`;
  }

  beforeAll(async () => {
    await seedTenant(tenantA, keyA, "wa-inbound-a");
    await seedTenant(tenantB, keyB, "wa-inbound-b");
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false, rawBody: true },
    );
    Object.assign(app.get(EffectivePricingService), effectivePricingStub());
    Object.assign(app.get(WhatsappRuntimeService), {
      resolve: async () => ({
        provider: new MetaWebhookProvider(),
        creds: CREDS,
      }),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get(KillSwitchService).list();
  });

  afterAll(async () => {
    await app?.close();
    await owner`DELETE FROM whatsapp_unattributed_inbound WHERE phone_number_id = ${PHONE_NUMBER_ID}`;
    for (const tenantId of [tenantA, tenantB]) {
      for (const table of [
        "whatsapp_inbound_messages",
        "whatsapp_service_windows",
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
    }
    await Promise.all([owner.end(), db.end()]);
  });

  it("attributes a reply to the tenant that messaged that consumer", async () => {
    await sendTo(keyA, CONSUMER, "inbound-seed-a");
    const wamid = `wamid.${randomUUID()}`;
    const response = await postInbound(CONSUMER, wamid);
    expect(response.statusCode).toBe(200);
    expect(unwrapEnvelope(response.json())).toMatchObject({
      accepted: true,
      processed: 1,
    });

    const rows = await inboundRows(tenantA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: tenantA,
      provider_ref: wamid,
      message_type: "text",
    });
    // The body is in the vault, never a column — a plaintext copy would survive PII erasure.
    expect(rows[0]?.content_pii_id).toBeTruthy();
    const columns = await owner`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'whatsapp_inbound_messages'`;
    const names = columns.map((c) => String(c.column_name));
    expect(names).not.toContain("from");
    expect(names).not.toContain("body");
  });

  it("opens a 24-hour service window on the inbound", async () => {
    const [window] = await owner`
      SELECT last_inbound_at, expires_at FROM whatsapp_service_windows
      WHERE tenant_id = ${tenantA}`;
    expect(window).toBeTruthy();
    const opened = new Date(String(window?.last_inbound_at)).getTime();
    const expires = new Date(String(window?.expires_at)).getTime();
    expect(expires - opened).toBe(24 * 60 * 60 * 1000);
  });

  it("emits exactly one message.received event for the inbound", async () => {
    const events = await owner`
      SELECT payload FROM outbox_events
      WHERE tenant_id = ${tenantA} AND event_type = 'message.received'`;
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      channel: "whatsapp",
      message_type: "text",
    });
  });

  it("ignores a replayed wamid — no second row, window bump or event", async () => {
    const wamid = `wamid.${randomUUID()}`;
    const first = await postInbound(CONSUMER, wamid);
    expect(unwrapEnvelope(first.json())).toMatchObject({ processed: 1 });
    const before = await owner`
      SELECT expires_at FROM whatsapp_service_windows WHERE tenant_id = ${tenantA}`;

    // Meta retries anything it believes failed. A retry must change nothing.
    const replay = await postInbound(CONSUMER, wamid);
    expect(replay.statusCode).toBe(200);
    expect(unwrapEnvelope(replay.json())).toMatchObject({ processed: 0 });

    const rows = await owner`
      SELECT id FROM whatsapp_inbound_messages
      WHERE tenant_id = ${tenantA} AND provider_ref = ${wamid}`;
    expect(rows).toHaveLength(1);
    const after = await owner`
      SELECT expires_at FROM whatsapp_service_windows WHERE tenant_id = ${tenantA}`;
    expect(String(after[0]?.expires_at)).toBe(String(before[0]?.expires_at));
  });

  it("gives the conversation to the tenant that spoke most recently", async () => {
    // Tenant A already messaged this consumer above. B now messages the same person, so B holds the
    // conversation — the shared-WABA cross-attribution ADR-0015 §2 names, asserted rather than hoped
    // against, so a future change to the rule fails here instead of in production.
    await sendTo(keyB, CONSUMER, "inbound-seed-b");
    const wamid = `wamid.${randomUUID()}`;
    expect(
      unwrapEnvelope((await postInbound(CONSUMER, wamid)).json()),
    ).toMatchObject({
      processed: 1,
    });

    const bRows = await owner`
      SELECT tenant_id FROM whatsapp_inbound_messages
      WHERE provider_ref = ${wamid}`;
    expect(bRows).toHaveLength(1);
    expect(String(bRows[0]?.tenant_id)).toBe(tenantB);
  });

  it("records an unattributable message instead of guessing an owner", async () => {
    const subjectsBefore = await owner`
      SELECT count(*)::int AS n FROM data_subjects
      WHERE tenant_id = ${tenantA} OR tenant_id = ${tenantB}`;
    const wamid = `wamid.${randomUUID()}`;
    const response = await postInbound(STRANGER, wamid);
    expect(response.statusCode).toBe(200);
    // Nothing was ingested for any tenant, and the webhook still succeeds — Meta must not retry.
    expect(unwrapEnvelope(response.json())).toMatchObject({ processed: 0 });

    const orphan = await owner`
      SELECT provider_ref, phone_number_id, message_type
      FROM whatsapp_unattributed_inbound WHERE provider_ref = ${wamid}`;
    expect(orphan[0]).toMatchObject({
      provider_ref: wamid,
      phone_number_id: PHONE_NUMBER_ID,
      message_type: "text",
    });
    // It carries nothing about the consumer: with no tenant there is no vault scope to encrypt into.
    const columns = await owner`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'whatsapp_unattributed_inbound'`;
    const names = columns.map((c) => String(c.column_name));
    expect(names).not.toContain("from");
    expect(names).not.toContain("subject_id");

    // And the probe left NO data-subject behind. Attribution asks every candidate tenant whether it
    // knows this number, and it must ask with the read-only lookup: the create-on-miss variant would
    // manufacture a data subject — a claimed relationship with a stranger — in every tenant on the
    // WABA. Asserted as an unchanged count rather than an absolute, since earlier cases in this file
    // legitimately created subjects of their own.
    const subjectsAfter = await owner`
      SELECT count(*)::int AS n FROM data_subjects
      WHERE tenant_id = ${tenantA} OR tenant_id = ${tenantB}`;
    expect(Number(subjectsAfter[0]?.n)).toBe(Number(subjectsBefore[0]?.n));
  });

  it("stores a media message it cannot render rather than dropping it", async () => {
    // An unmodelled type is still a real customer in a real conversation. Dropping it would lose the
    // message AND fail to extend the window.
    const wamid = `wamid.${randomUUID()}`;
    expect(
      unwrapEnvelope((await postInbound(CONSUMER, wamid, "image")).json()),
    ).toMatchObject({
      processed: 1,
    });
    const rows = await owner`
      SELECT message_type FROM whatsapp_inbound_messages
      WHERE provider_ref = ${wamid}`;
    expect(rows[0]?.message_type).toBe("image");
  });
});
