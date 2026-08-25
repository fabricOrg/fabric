import { createAppDb } from "@app/db";
import { credit } from "@app/wallet";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "../api-keys/api-key.crypto.js";
import { AppModule } from "../app.module.js";
import { ConsentService } from "../consent/consent.service.js";
import { PiiErasureService } from "../privacy/pii-erasure.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { jsonBody } from "../testing/response.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL)
  throw new Error("sandbox-routing requires both database URLs.");
process.env.DATABASE_URL_APP = APP_URL;
process.env.SMS_PROVIDER = "arkesel";
process.env.ARKESEL_API_KEY = ""; // no creds — an accidental real call could never succeed anyway
process.env.REDIS_QUEUE_URL = ""; // inline path: assert the synchronous outcome
process.env.PII_MASTER_KEY =
  "integration-pii-master-key-at-least-32-characters";
const SANDBOX_TENANT = "abcdabcd-0000-4000-8000-0000000000f3";
const LIVE_TENANT = "abcdabcd-1111-4111-8111-0000000000f3";
const SANDBOX_KEY = `sk_test_${"f".repeat(40)}`;
const LIVE_KEY = `sk_test_${"a".repeat(40)}`;
const CURRENCY = "GHS";
const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 2 });
let app: NestFastifyApplication;

async function seedTenant(id: string, plan: string, rawKey: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug, plan) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
    [id, `Routing ${plan}`, `routing-${plan}-${id.slice(0, 8)}`, plan],
  );
  const appRows = (await owner.unsafe(
    `INSERT INTO applications (tenant_id, name, slug) VALUES ($1, 'Default', 'default')
     ON CONFLICT (tenant_id, slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
    [id],
  )) as Array<{ id: string }>;
  const appId = appRows[0]?.id;
  if (!appId) throw new Error("seed: default application id missing");
  const sbRows = (await owner.unsafe(
    `INSERT INTO environments (tenant_id, application_id, type, status)
     VALUES ($1, $2, 'sandbox', 'active')
     ON CONFLICT (application_id, type) DO UPDATE SET status = 'active' RETURNING id`,
    [id, appId],
  )) as Array<{ id: string }>;
  const sandboxEnvId = sbRows[0]?.id;
  if (!sandboxEnvId) throw new Error("seed: sandbox environment id missing");
  await owner.unsafe(
    `INSERT INTO environments (tenant_id, application_id, type, status)
     VALUES ($1, $2, 'live', $3) ON CONFLICT (application_id, type) DO NOTHING`,
    [id, appId, plan === "sandbox" ? "locked" : "active"],
  );
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, $3, $4, 'sk_test_rout', $2, 'test', '["sms:send","sms:read"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [id, hashApiKey(rawKey), appId, sandboxEnvId],
  );
  if (plan !== "sandbox") {
    await db.withTenant(id, (tx) =>
      credit(tx, {
        currency: CURRENCY,
        amountMinor: 10_000n,
        idempotencyKey: `topup:routing-seed-${id}`,
      }),
    );
    await owner.unsafe(
      `INSERT INTO senders (tenant_id, sender_id, country, use_case, status, carrier_status)
       VALUES ($1, 'FABRIC', 'GH', 'routing integration', 'active', 'approved')
       ON CONFLICT ON CONSTRAINT uniq_sender_tenant_id_country DO NOTHING`,
      [id],
    );
  }
}

async function cleanTenant(id: string) {
  for (const table of [
    "sandbox_usage_events",
    "sandbox_usage_buckets",
    "senders",
    "inbound_messages",
    "opt_outs",
    "outbox_events",
    "virtual_deliveries",
    "pii_vault",
    "dek_keys",
    "erasure_log",
    "data_subjects",
    "ledger_entries",
    "ledger_transactions",
    "ledger_accounts",
    "messages",
    "api_keys",
  ]) {
    await owner.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [id]);
  }
  await owner.unsafe("DELETE FROM accounts WHERE id = $1", [id]);
}

async function sendAs(rawKey: string, to = "+233545227189") {
  return app.inject({
    method: "POST",
    url: "/v1/sms/messages",
    headers: {
      authorization: `Bearer ${rawKey}`,
      "content-type": "application/json",
    },
    payload: {
      to,
      sender_id: "FABRIC",
      body: "routing pin test",
      currency: CURRENCY,
    },
  });
}

async function providerOf(tenantId: string): Promise<string | null> {
  const rows = (await owner.unsafe(
    "SELECT provider_slug FROM messages WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
    [tenantId],
  )) as Array<{ provider_slug: string | null }>;
  return rows[0]?.provider_slug ?? null;
}

beforeAll(async () => {
  await seedTenant(SANDBOX_TENANT, "sandbox", SANDBOX_KEY);
  await seedTenant(LIVE_TENANT, "free", LIVE_KEY);
  app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await cleanTenant(SANDBOX_TENANT);
  await cleanTenant(LIVE_TENANT);
  await owner.end();
  await db.end();
});

describe("sandbox provider pinning (F3)", () => {
  it("delivers a sandbox send through the virtual phone, PII in the vault", async () => {
    const res = await sendAs(SANDBOX_KEY);
    expect(res.statusCode).toBe(201);
    expect((jsonBody(res) as { status: string }).status).toBe("delivered");
    await expect(providerOf(SANDBOX_TENANT)).resolves.toBe("virtual-phone");

    const rows = (await owner.unsafe(
      `SELECT v.subject_id, v.body_pii_id, m.status, m.subject_id AS message_subject
       FROM virtual_deliveries v JOIN messages m ON m.id = v.message_id
       WHERE v.tenant_id = $1 ORDER BY v.created_at DESC LIMIT 1`,
      [SANDBOX_TENANT],
    )) as Array<Record<string, unknown>>;
    expect(rows[0]?.status).toBe("delivered");
    expect(rows[0]?.subject_id).toBeTruthy();
    expect(rows[0]?.body_pii_id).toBeTruthy();
    expect(rows[0]?.message_subject).toBe(rows[0]?.subject_id);

    const vault = (await owner.unsafe(
      "SELECT kind, ciphertext FROM pii_vault WHERE tenant_id = $1",
      [SANDBOX_TENANT],
    )) as Array<{ kind: string; ciphertext: Buffer }>;
    expect(vault.map((row) => row.kind).sort()).toEqual(["body", "phone"]);
    for (const row of vault) {
      const raw = Buffer.from(row.ciphertext).toString("utf8");
      expect(raw).not.toContain("+233545227189");
      expect(raw).not.toContain("routing pin test");
    }
  });

  it("does not expose a virtual delivery in another tenant context", async () => {
    const rows = await db.withTenant(
      LIVE_TENANT,
      (tx) => tx`SELECT message_id FROM virtual_deliveries`,
    );
    expect(rows).toHaveLength(0);
  });

  it("assigns a stable non-routable number and handles STOP/START canonically", async () => {
    const virtual = app.get(VirtualPhoneService);
    const number = virtual.virtualNumber(SANDBOX_TENANT);
    expect(number).toMatch(/^\+999\d{9}$/);
    expect(virtual.virtualNumber(SANDBOX_TENANT)).toBe(number);
    expect(virtual.virtualNumber(LIVE_TENANT)).not.toBe(number);

    const stopped = await virtual.reply(SANDBOX_TENANT, {
      to: "+233545227189",
      body: "  stop  ",
    });
    expect(stopped.keyword).toBe("STOP");
    expect(stopped.consent_changed).toBe(true);
    await expect(
      app
        .get(ConsentService)
        .isSuppressed(SANDBOX_TENANT, "+233545227189", "promotional"),
    ).resolves.toBe(true);

    const inbound = (await owner.unsafe(
      "SELECT keyword, virtual_number FROM inbound_messages WHERE id = $1",
      [stopped.id],
    )) as Array<{ keyword: string; virtual_number: string }>;
    expect(inbound[0]).toEqual({ keyword: "STOP", virtual_number: number });
    const events = (await owner.unsafe(
      "SELECT event_type, application_id, environment_id FROM outbox_events WHERE tenant_id = $1 ORDER BY created_at",
      [SANDBOX_TENANT],
    )) as Array<Record<string, string | null>>;
    expect(events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(["message.received", "contact.opted_out"]),
    );
    const inboundEvent = events.find(
      (event) => event.event_type === "message.received",
    );
    expect(inboundEvent?.application_id).toEqual(expect.any(String));
    expect(inboundEvent?.environment_id).toEqual(expect.any(String));

    const started = await virtual.reply(SANDBOX_TENANT, {
      to: "+233545227189",
      body: "START",
    });
    expect(started.keyword).toBe("START");
    expect(started.consent_changed).toBe(true);
    await expect(
      app
        .get(ConsentService)
        .isSuppressed(SANDBOX_TENANT, "+233545227189", "promotional"),
    ).resolves.toBe(false);

    const inbox = await virtual.list(SANDBOX_TENANT);
    expect(inbox.virtual_number).toBe(number);
    expect(
      inbox.messages.filter((message) => message.direction === "inbound"),
    ).toHaveLength(2);
  });

  it("crypto-shred erasure makes PII unreadable while ledger + history survive", async () => {
    const vaultService = app.get(PiiVaultService);
    const [subject] = (await owner.unsafe(
      "SELECT subject_id FROM data_subjects WHERE tenant_id = $1 LIMIT 1",
      [SANDBOX_TENANT],
    )) as Array<{ subject_id: string }>;
    expect(subject?.subject_id).toBeTruthy();
    if (!subject) throw new Error("no subject seeded");

    const phoneBefore = await vaultService.readLatest(
      SANDBOX_TENANT,
      subject.subject_id,
      "phone",
    );
    expect(phoneBefore).toBe("+233545227189");

    const ledgerBefore = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id = $1",
      [SANDBOX_TENANT],
    )) as Array<{ n: number }>;

    await app.get(PiiErasureService).eraseByPhone({
      tenantId: SANDBOX_TENANT,
      e164: "+233545227189",
      requestedBy: "ops@fabric.dev",
      basis: "DSR erasure request",
    });

    await expect(
      vaultService.readLatest(SANDBOX_TENANT, subject.subject_id, "phone"),
    ).resolves.toBeNull();

    const virtual = app.get(VirtualPhoneService);
    const inbox = await virtual.list(SANDBOX_TENANT);
    expect(inbox.messages[0]?.erased).toBe(true);
    for (const item of inbox.messages) {
      expect(item.body).toBe("[erased]");
      expect(item.direction === "inbound" ? item.from : item.to).toBe(
        "[erased]",
      );
    }

    const ledgerAfter = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id = $1",
      [SANDBOX_TENANT],
    )) as Array<{ n: number }>;
    expect(ledgerAfter[0]?.n).toBe(ledgerBefore[0]?.n);
    expect(inbox.messages[0]?.status).toBe("delivered");
    expect(inbox.messages[0]?.segments).toBeGreaterThan(0);

    const proof = (await owner.unsafe(
      "SELECT completed_at FROM erasure_log WHERE tenant_id = $1 AND subject_id = $2",
      [SANDBOX_TENANT, subject.subject_id],
    )) as Array<{ completed_at: Date | null }>;
    expect(proof[0]?.completed_at).toBeTruthy();

    const audited = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM audit_events WHERE action = $1 AND target_id = $2",
      ["privacy.subject.erased", subject.subject_id],
    )) as Array<{ n: number }>;
    expect(audited[0]?.n).toBe(1);
  });

  it("can still message a number after erasing it — a new subject is minted", async () => {
    const [before] = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM data_subjects WHERE tenant_id = $1",
      [SANDBOX_TENANT],
    )) as Array<{ n: number }>;

    const res = await sendAs(SANDBOX_KEY);
    expect(res.statusCode).toBe(201);
    expect((jsonBody(res) as { status: string }).status).toBe("delivered");

    const [after] = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM data_subjects WHERE tenant_id = $1",
      [SANDBOX_TENANT],
    )) as Array<{ n: number }>;
    expect(after?.n).toBe((before?.n ?? 0) + 1);

    const live = (await owner.unsafe(
      "SELECT subject_id FROM data_subjects WHERE tenant_id = $1 AND erased_at IS NULL",
      [SANDBOX_TENANT],
    )) as Array<{ subject_id: string }>;
    expect(live).toHaveLength(1);

    const inbox = await app.get(VirtualPhoneService).list(SANDBOX_TENANT);
    expect(inbox.messages[0]?.erased).toBe(false);
    expect(inbox.messages[0]?.to).toBe("+233545227189");
    expect(inbox.messages.at(-1)?.erased).toBe(true);
  });

  it("clears the inbox, removes message bodies, and records an audit event", async () => {
    const virtual = app.get(VirtualPhoneService);
    const cleared = await virtual.clear(SANDBOX_TENANT, "owner@fabric.dev");
    expect(cleared).toBeGreaterThan(0);
    await expect(virtual.list(SANDBOX_TENANT)).resolves.toMatchObject({
      messages: [],
    });
    const audit = (await owner.unsafe(
      "SELECT actor_email FROM audit_events WHERE action = 'tenant.virtual_phone.inbox_cleared' AND target_id = $1 ORDER BY created_at DESC LIMIT 1",
      [SANDBOX_TENANT],
    )) as Array<{ actor_email: string }>;
    expect(audit[0]?.actor_email).toBe("owner@fabric.dev");
  });
});
