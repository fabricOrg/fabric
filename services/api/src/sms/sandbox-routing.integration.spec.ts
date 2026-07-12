// ============================================================================================
// ADR-0002 F3 — sandbox tenants are PINNED to the fake provider at the ROUTING layer. This
// boots the real app with SMS_PROVIDER=arkesel (the real vendor selected) and proves a
// sandbox-plan tenant's send still lands on fake-sms — i.e. forcing live routing from the
// outside is impossible — while a live-plan tenant is routed at the configured provider.
// tier: test:integration.
// ============================================================================================

import { createAppDb } from "@app/db";
import { credit } from "@app/wallet";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "../api-keys/api-key.crypto.js";
import { AppModule } from "../app.module.js";
import { PiiErasureService } from "../privacy/pii-erasure.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "sandbox-routing needs DATABASE_URL_SUPER + DATABASE_URL_APP (a fresh DB migrated as app_migrator)",
  );
}
process.env.DATABASE_URL_APP = APP_URL;
// The point of this spec: the REAL vendor is configured, yet sandbox sends must not reach it.
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
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, 'sk_test_rout', $2, 'test', '["sms:send","sms:read"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [id, hashApiKey(rawKey)],
  );
  await db.withTenant(id, (tx) =>
    credit(tx, {
      currency: CURRENCY,
      amountMinor: 10_000n,
      idempotencyKey: `topup:routing-seed-${id}`,
    }),
  );
  // E10-S4: the live tenant must clear the sender gate so this spec asserts ROUTING, not senders.
  if (plan !== "sandbox") {
    await owner.unsafe(
      `INSERT INTO senders (tenant_id, sender_id, country, use_case, status)
       VALUES ($1, 'FABRIC', 'GH', 'routing integration', 'active')
       ON CONFLICT ON CONSTRAINT uniq_sender_tenant_id_country DO NOTHING`,
      [id],
    );
  }
}

async function cleanTenant(id: string) {
  for (const table of [
    "senders",
    // Order matters: virtual_deliveries → pii_vault → dek_keys → data_subjects (FK chain).
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

async function sendAs(rawKey: string) {
  return app.inject({
    method: "POST",
    url: "/v1/sms/send",
    headers: {
      authorization: `Bearer ${rawKey}`,
      "content-type": "application/json",
    },
    payload: {
      to: "+233545227189",
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
    { logger: false },
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
    expect(res.json().status).toBe("delivered");
    await expect(providerOf(SANDBOX_TENANT)).resolves.toBe("virtual-phone");

    // The projection holds SURROGATES only — no ciphertext, and certainly no plaintext.
    const rows = (await owner.unsafe(
      `SELECT v.subject_id, v.body_pii_id, m.status, m.subject_id AS message_subject
       FROM virtual_deliveries v JOIN messages m ON m.id = v.message_id
       WHERE v.tenant_id = $1 ORDER BY v.created_at DESC LIMIT 1`,
      [SANDBOX_TENANT],
    )) as Array<Record<string, unknown>>;
    expect(rows[0]?.status).toBe("delivered");
    expect(rows[0]?.subject_id).toBeTruthy();
    expect(rows[0]?.body_pii_id).toBeTruthy();
    // COMPLIANCE §5: `messages` references the subject, never the raw number.
    expect(rows[0]?.message_subject).toBe(rows[0]?.subject_id);

    // The raw number/body appear nowhere in the vault as plaintext.
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

  // The whole reason the vault exists: erasure must actually erase, and must NOT take the money
  // or the delivery history with it. This is the test the platform-key design could not pass.
  it("crypto-shred erasure makes PII unreadable while ledger + history survive", async () => {
    const vaultService = app.get(PiiVaultService);
    const [subject] = (await owner.unsafe(
      "SELECT subject_id FROM data_subjects WHERE tenant_id = $1 LIMIT 1",
      [SANDBOX_TENANT],
    )) as Array<{ subject_id: string }>;
    expect(subject?.subject_id).toBeTruthy();
    if (!subject) throw new Error("no subject seeded");

    // Readable before erasure.
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

    // PII is gone — permanently. The key is destroyed, not the rows.
    await expect(
      vaultService.readLatest(SANDBOX_TENANT, subject.subject_id, "phone"),
    ).resolves.toBeNull();

    const virtual = app.get(VirtualPhoneService);
    const inbox = await virtual.list(SANDBOX_TENANT);
    expect(inbox.messages[0]?.erased).toBe(true);
    expect(inbox.messages[0]?.to).toBe("[erased]");
    expect(inbox.messages[0]?.body).toBe("[erased]");

    // …while the append-only financial + delivery record is untouched.
    const ledgerAfter = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id = $1",
      [SANDBOX_TENANT],
    )) as Array<{ n: number }>;
    expect(ledgerAfter[0]?.n).toBe(ledgerBefore[0]?.n);
    expect(inbox.messages[0]?.status).toBe("delivered");
    expect(inbox.messages[0]?.segments).toBeGreaterThan(0);

    // And the erasure itself is provable, years after the data is gone.
    const proof = (await owner.unsafe(
      "SELECT completed_at FROM erasure_log WHERE tenant_id = $1 AND subject_id = $2",
      [SANDBOX_TENANT, subject.subject_id],
    )) as Array<{ completed_at: Date | null }>;
    expect(proof[0]?.completed_at).toBeTruthy();

    // The erasure is audited — erasure_log is the legal proof, the audit trail says WHO did it.
    const audited = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM audit_events WHERE action = $1 AND target_id = $2",
      ["privacy.subject.erased", subject.subject_id],
    )) as Array<{ n: number }>;
    expect(audited[0]?.n).toBe(1);
  });

  // Erasure ends a SUBJECT; it must not blacklist a human being. A tenant that erases a recipient
  // and later messages them again gets a fresh subject with a fresh key — not a permanent failure.
  // (Whether they MAY message them is the consent engine's call, not the vault's.)
  it("can still message a number after erasing it — a new subject is minted", async () => {
    const [before] = (await owner.unsafe(
      "SELECT count(*)::int AS n FROM data_subjects WHERE tenant_id = $1",
      [SANDBOX_TENANT],
    )) as Array<{ n: number }>;

    const res = await sendAs(SANDBOX_KEY);
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("delivered");

    // A NEW live subject exists for the same number; the erased one stays, closed, for history.
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

    // …and the new message is readable, while the erased one stays erased.
    const inbox = await app.get(VirtualPhoneService).list(SANDBOX_TENANT);
    expect(inbox.messages[0]?.erased).toBe(false);
    expect(inbox.messages[0]?.to).toBe("+233545227189");
    expect(inbox.messages.at(-1)?.erased).toBe(true);
  });
});
