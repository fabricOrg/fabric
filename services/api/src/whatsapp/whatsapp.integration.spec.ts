import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import type { WhatsAppSenderPlugin } from "@app/integrations";
import { FakeWhatsAppProvider } from "@app/integrations/testing/whatsapp";
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
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { SandboxAllowanceService } from "../sandbox-allowance/sandbox-allowance.service.js";
import { effectivePricingStub } from "../testing/effective-pricing.stub.js";
import { WhatsappService } from "./whatsapp.service.js";
import {
  BlockingWhatsAppProvider,
  FailingWhatsAppProvider,
  whatsappPayload,
} from "./whatsapp.test-doubles.js";
import { prepareWhatsapp } from "./whatsapp-prepare.js";
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;
process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.PII_MASTER_KEY = "whatsapp-integration-pii-key-at-least-32-chars";

describeDb("public WhatsApp API", () => {
  const owner = postgres(SUPER_URL ?? "", { max: 2 });
  const db = createAppDb(APP_URL ?? "", { max: 2 });
  const tenantId = randomUUID();
  const appId = randomUUID();
  const sandboxId = randomUUID();
  const liveId = randomUUID();
  // Randomised per run, like verify.integration.spec.ts. The tenant/app/env ids above are already
  // random, but a FIXED key string hashes to a fixed value — so a run that crashes before afterAll
  // leaves rows behind and every later run dies in beforeAll on `uniq_api_key_hash`, which reads as
  // a product bug rather than stale fixtures. It cost one run here already.
  const keySalt = randomUUID().replace(/-/g, "");
  const sandboxKey = `sk_test_${keySalt}${"4".repeat(8)}`;
  const liveKey = `sk_live_${keySalt}${"5".repeat(8)}`;
  const noScopeKey = `sk_test_${keySalt}${"6".repeat(8)}`;
  let app: NestFastifyApplication;
  let messageId = "";
  let whatsappProvider: WhatsAppSenderPlugin = new FakeWhatsAppProvider();

  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'WhatsApp API', ${`wa-${tenantId}`})`;
    await owner`
      INSERT INTO applications (id, tenant_id, name, slug)
      VALUES (${appId}, ${tenantId}, 'Primary', 'primary')`;
    await owner`
      INSERT INTO environments (id, tenant_id, application_id, type, status)
      VALUES
        (${sandboxId}, ${tenantId}, ${appId}, 'sandbox', 'active'),
        (${liveId}, ${tenantId}, ${appId}, 'live', 'active')`;
    await owner`
      INSERT INTO api_keys (
        tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
      ) VALUES
        (${tenantId}, ${appId}, ${sandboxId}, 'sk_test_wa',
         ${hashApiKey(sandboxKey)}, 'test', '["whatsapp:send"]'::jsonb, 'active'),
        (${tenantId}, ${appId}, ${liveId}, 'sk_live_wa',
         ${hashApiKey(liveKey)}, 'live', '["whatsapp:send"]'::jsonb, 'active'),
        (${tenantId}, ${appId}, ${sandboxId}, 'sk_test_wa_no_scope',
         ${hashApiKey(noScopeKey)}, 'test', '["sms:send"]'::jsonb, 'active')`;
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    Object.assign(app.get(EffectivePricingService), effectivePricingStub());
    Object.assign(app.get(WhatsappRuntimeService), {
      resolve: async () => ({
        provider: whatsappProvider,
        creds: {},
      }),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get(KillSwitchService).list();
  });

  afterAll(async () => {
    await app
      ?.get(KillSwitchService)
      .toggle(
        "platform.whatsapp_sending",
        { enabled: true, reason: "test cleanup" },
        { email: "test@fabric.dev" },
      );
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

  it("rejects API keys without whatsapp:send", async () => {
    const response = await send(noScopeKey, "missing-scope-1");
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "insufficient_scope" },
    });
  });

  it("routes sandbox sends to sandbox-whatsapp, meters them, stores no raw recipient, and replays idempotently", async () => {
    const first = await send(sandboxKey, "wa-sandbox-1");
    const replay = await send(sandboxKey, "wa-sandbox-1");
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    const body = first.json() as {
      id: string;
      provider: string;
      status: string;
    };
    messageId = body.id;
    expect(body.provider).toBe("sandbox-whatsapp");
    expect(body.status).toBe("accepted");
    expect((replay.json() as { id: string }).id).toBe(messageId);

    const rows = await owner`
      SELECT m.provider_slug, m.provider_ref, m.subject_id, m.cost_minor::text AS cost_minor
      FROM whatsapp_messages m WHERE m.id = ${messageId}`;
    expect(rows[0]).toMatchObject({
      provider_slug: "sandbox-whatsapp",
      provider_ref: `fake-whatsapp-${messageId}`,
      cost_minor: "0",
    });
    const metered = await owner`
      SELECT used_units::text AS used_units FROM sandbox_usage_buckets
      WHERE tenant_id = ${tenantId} AND channel = 'whatsapp'`;
    expect(metered[0]?.used_units).toBe("1");
    const rawLeak = await owner`
      SELECT count(*)::int AS leaks
      FROM whatsapp_messages
      WHERE tenant_id = ${tenantId}
        AND whatsapp_messages::text LIKE '%+233545227189%'`;
    expect(Number(rawLeak[0]?.leaks)).toBe(0);

    const blockingProvider = new BlockingWhatsAppProvider();
    whatsappProvider = blockingProvider;
    const claimedMessageId = await prepareWhatsapp({
      db,
      vault: app.get(PiiVaultService),
      sandboxAllowance: app.get(SandboxAllowanceService),
      runtime: app.get(WhatsappRuntimeService),
      context: {
        tenantId,
        applicationId: appId,
        environmentId: sandboxId,
      },
      content: whatsappPayload(),
    });

    const firstProcess = app
      .get(WhatsappService)
      .process({ tenantId, messageId: claimedMessageId });
    await blockingProvider.started;
    const second = await app
      .get(WhatsappService)
      .process({ tenantId, messageId: claimedMessageId });
    expect(second).toBe("sending");
    blockingProvider.release();
    await expect(firstProcess).resolves.toBe("accepted");
    expect(blockingProvider.calls).toBe(1);
    whatsappProvider = new FakeWhatsAppProvider();
  });

  it("has the WhatsApp kill switch seeded and blocks when flipped", async () => {
    const seeded = await owner`
      SELECT key, scope, enabled FROM kill_switches
      WHERE key = 'platform.whatsapp_sending' AND tenant_id IS NULL`;
    expect(seeded[0]).toMatchObject({
      key: "platform.whatsapp_sending",
      scope: "platform",
      enabled: true,
    });
    await app
      .get(KillSwitchService)
      .toggle(
        "platform.whatsapp_sending",
        { enabled: false, reason: "integration test" },
        { email: "test@fabric.dev" },
      );
    const response = await send(sandboxKey, "wa-paused-1");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "whatsapp_sending_paused" },
    });
    await app
      .get(KillSwitchService)
      .toggle(
        "platform.whatsapp_sending",
        { enabled: true, reason: "integration test" },
        { email: "test@fabric.dev" },
      );
  });

  it("refuses live sends with no funding before dispatch", async () => {
    const response = await send(liveKey, "wa-unfunded-1");
    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({
      error: { code: "insufficient_funds" },
    });
  });

  it("charges a funded live send once on idempotent replay", async () => {
    await db.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 10_000n,
        idempotencyKey: "topup:whatsapp-funded",
      }),
    );
    const first = await send(liveKey, "wa-live-funded-1");
    const replay = await send(liveKey, "wa-live-funded-1");
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { id: string }).id).toBe(
      (first.json() as { id: string }).id,
    );
    // A send legitimately writes TWO ledger rows against one reference: the `pending` reserve and the
    // `committed` terminal. Counting all `sms_charge` rows and expecting 1 therefore fails on a
    // perfectly correct send — it reads as a double charge and is not one. What "charged once" means
    // is exactly one TERMINAL transaction for this message, which is also what the partial unique
    // index on (tenant_id, reference_id) WHERE status IN ('committed','refunded') enforces.
    const messageId = (first.json() as { id: string }).id;
    const terminal = await owner`
      SELECT count(*)::int AS count FROM ledger_transactions
       WHERE tenant_id = ${tenantId}
         AND reference_id = ${messageId}
         AND status IN ('committed', 'refunded')`;
    expect(Number(terminal[0]?.count)).toBe(1);
    // And the replay must not have produced a second message to charge for.
    const sends = await owner`
      SELECT count(*)::int AS count FROM whatsapp_messages
       WHERE tenant_id = ${tenantId} AND id = ${messageId}`;
    expect(Number(sends[0]?.count)).toBe(1);
  });

  it("refunds a live send the provider never accepted", async () => {
    await db.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: 10_000n,
        idempotencyKey: "topup:whatsapp-refund",
      }),
    );
    const previous = whatsappProvider;
    whatsappProvider = new FailingWhatsAppProvider();
    try {
      const res = await send(liveKey, `wa-live-fail-${randomUUID()}`);
      expect(res.statusCode).toBe(201);
      const id = (res.json() as { id: string }).id;

      const [msg] = await owner`
        SELECT status::text, provider_ref FROM whatsapp_messages WHERE id = ${id}`;
      expect(msg?.status).toBe("failed");
      expect(msg?.provider_ref).toBeNull();

      // The money question: a send that never reached the provider must RELEASE the reservation, not
      // recognise it. Asserting the terminal transaction is `refunded` rather than merely "some
      // terminal row exists" is the difference between catching this and re-shipping it — the bug
      // committed, which also looks terminal.
      const [txn] = await owner`
        SELECT status FROM ledger_transactions
         WHERE reference_id = ${id} AND status IN ('committed', 'refunded')`;
      expect(txn?.status).toBe("refunded");
    } finally {
      whatsappProvider = previous;
    }
  });

  function send(rawKey: string, idempotencyKey: string) {
    return app.inject({
      method: "POST",
      url: "/v1/whatsapp/messages",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: {
        ...whatsappPayload(),
      },
    });
  }
});
