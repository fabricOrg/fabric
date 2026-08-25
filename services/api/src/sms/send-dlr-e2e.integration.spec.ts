import "reflect-metadata";
import { createAppDb } from "@app/db";
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
import { EffectivePricingService } from "../pricing/effective-pricing.service.js";
import { effectivePricingStub } from "../testing/effective-pricing.stub.js";
import { jsonBody } from "../testing/response.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "send-dlr-e2e needs DATABASE_URL_SUPER + DATABASE_URL_APP (a fresh DB migrated as app_migrator)",
  );
}
process.env.DATABASE_URL_APP = APP_URL;
process.env.WEBHOOK_INGRESS_TOKEN = "integration-webhook-token";
process.env.REDIS_QUEUE_URL = "";
const TENANT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const APPLICATION = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01";
const ENVIRONMENT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee11";
const OTHER_APPLICATION = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02";
const OTHER_ENVIRONMENT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee12";
const ACTIVE_RAW = `sk_live_${"e".repeat(40)}`;
const OTHER_RAW = `sk_live_${"f".repeat(40)}`;
const CURRENCY = "GHS";
const FUNDING_MINOR = 100_000n;

const owner = postgres(SUPER_URL, { max: 2 }); // superuser: seed + read balances (bypasses FORCE RLS)
const db = createAppDb(APP_URL, { max: 2 }); // app_runtime: RLS-enforced (used to fund via withTenant)
let app: NestFastifyApplication;
interface BalRow {
  b: string;
}
async function balance(kind: string): Promise<bigint> {
  const rows = (await owner.unsafe(
    "SELECT COALESCE(balance_minor, 0)::text AS b FROM ledger_accounts WHERE tenant_id = $1 AND kind = $2 AND currency = $3",
    [TENANT, kind, CURRENCY],
  )) as BalRow[];
  return rows[0] ? BigInt(rows[0].b) : 0n;
}

beforeAll(async () => {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, 'Tenant E', 'tenant-e') ON CONFLICT (id) DO NOTHING",
    [TENANT],
  );
  await owner.unsafe(
    `INSERT INTO applications (id, tenant_id, name, slug)
     VALUES ($1, $3, 'Primary', 'primary'), ($2, $3, 'Other', 'other')
     ON CONFLICT (id) DO NOTHING`,
    [APPLICATION, OTHER_APPLICATION, TENANT],
  );
  await owner.unsafe(
    `INSERT INTO environments (id, tenant_id, application_id, type, status)
     VALUES ($1, $3, $4, 'live', 'active'), ($2, $3, $5, 'live', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [ENVIRONMENT, OTHER_ENVIRONMENT, TENANT, APPLICATION, OTHER_APPLICATION],
  );
  await owner.unsafe(
    `INSERT INTO api_keys (
       tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
     )
     VALUES
       ($1, $3, $4, 'sk_live_e2e', $2, 'live', '["sms:send","sms:read","wallet:read"]'::jsonb, 'active'),
       ($1, $5, $6, 'sk_live_other', $7, 'live', '["sms:read"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [
      TENANT,
      hashApiKey(ACTIVE_RAW),
      APPLICATION,
      ENVIRONMENT,
      OTHER_APPLICATION,
      OTHER_ENVIRONMENT,
      hashApiKey(OTHER_RAW),
    ],
  );
  await owner.unsafe(
    `INSERT INTO senders (tenant_id, sender_id, country, use_case, status, carrier_status)
     VALUES ($1, 'JOJO', 'GH', 'walking-skeleton e2e', 'active', 'approved')
     ON CONFLICT ON CONSTRAINT uniq_sender_tenant_id_country DO NOTHING`,
    [TENANT],
  );

  // 3. fund via a real double-entry top-up (debit gateway_clearing / credit customer) — the balance
  //    is maintained by the write-time trigger, so the invariant holds without any hand-set balance.
  await db.withTenant(TENANT, (tx) =>
    credit(tx, {
      currency: CURRENCY,
      amountMinor: FUNDING_MINOR,
      idempotencyKey: "topup:e2e-seed",
      referenceId: TENANT,
    }),
  );

  app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );
  Object.assign(app.get(EffectivePricingService), effectivePricingStub());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  // clean this spec's rows so a re-run on the same DB is idempotent (children before parents).
  await owner.unsafe("DELETE FROM ledger_entries WHERE tenant_id = $1", [
    TENANT,
  ]);
  await owner.unsafe("DELETE FROM ledger_transactions WHERE tenant_id = $1", [
    TENANT,
  ]);
  await owner.unsafe("DELETE FROM ledger_accounts WHERE tenant_id = $1", [
    TENANT,
  ]);
  await owner.unsafe("DELETE FROM messages WHERE tenant_id = $1", [TENANT]);
  await owner.unsafe("DELETE FROM senders WHERE tenant_id = $1", [TENANT]);
  await owner.unsafe("DELETE FROM api_keys WHERE tenant_id = $1", [TENANT]);
  await owner.unsafe("DELETE FROM accounts WHERE id = $1", [TENANT]);
  await owner.end();
  await db.end();
});

describe("walking-skeleton capstone: authed send → DLR → correct money (E2E)", () => {
  let messageId: string;
  let cost: bigint;

  it("5+6. POST /v1/sms/messages with a valid key charges the customer exactly once (committed at accepted)", async () => {
    const funded = await balance("customer");
    expect(funded).toBe(FUNDING_MINOR); // seed landed via the ledger, not a hand-set balance

    const res = await app.inject({
      method: "POST",
      url: "/v1/sms/messages",
      headers: {
        authorization: `Bearer ${ACTIVE_RAW}`,
        "content-type": "application/json",
      },
      payload: {
        to: "+233200000001", // normal number → FakeProvider 'delivered' happy path
        sender_id: "JOJO",
        body: "hello from the jojo walking skeleton",
        currency: CURRENCY,
      },
    });

    expect(res.statusCode).toBe(201);
    const json = jsonBody(res) as {
      id: string;
      status: string;
      request_id: string;
    };
    expect(json.status).toBe("accepted"); // provider ack → committed (honest-billing)
    expect(json.request_id).toMatch(/^req_/);
    messageId = json.id;

    // money moved EXACTLY ONCE: customer ↓ cost, reservation cleared to revenue, nothing parked.
    cost = funded - (await balance("customer"));
    expect(cost).toBeGreaterThan(0n); // GHS = 3 pesewas/segment × 1 segment
    expect(await balance("reserved_clearing")).toBe(0n); // committed, not left reserved
    expect(await balance("revenue")).toBe(cost); // recognized once
  });

  // Also PROVES the send above went to the fake provider: a real-vendor ref 404s on this route.
  it("7. POST /webhooks/dlr/fake-sms {delivered} is accepted and does NOT move money again", async () => {
    const customerBefore = await balance("customer");
    const revenueBefore = await balance("revenue");

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/dlr/fake-sms",
      headers: {
        "content-type": "application/json",
        "x-webhook-token": "integration-webhook-token",
      },
      payload: {
        providerRef: `fake-${messageId}`, // deterministic ref the provider assigned at 'accepted'
        status: "delivered",
        occurredAt: "1970-01-01T00:00:00.000Z",
        segments: 1,
      },
    });

    expect(res.statusCode).toBe(201);
    expect((jsonBody(res) as { status: string }).status).toBe("delivered");
    // post-commit DLR is a no-op for money (decideResolution → 'none'): balances unchanged.
    expect(await balance("customer")).toBe(customerBefore);
    expect(await balance("revenue")).toBe(revenueBefore);
    expect(await balance("reserved_clearing")).toBe(0n);
  });

  it("exposes the resulting message and exact wallet ledger through tenant-scoped reads", async () => {
    const headers = { authorization: `Bearer ${ACTIVE_RAW}` };
    const messages = await app.inject({
      method: "GET",
      url: "/v1/messages",
      headers,
    });
    expect(messages.statusCode).toBe(200);
    const messageBody = jsonBody(messages) as {
      messages: Array<{ id: string; status: string; cost: { minor: string } }>;
      request_id: string;
    };
    expect(messageBody.request_id).toMatch(/^req_/);
    expect(messageBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: messageId,
          status: "delivered",
          cost: { currency: "GHS", minor: cost.toString() },
        }),
      ]),
    );

    const detail = await app.inject({
      method: "GET",
      url: `/v1/sms/${messageId}`,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    expect(jsonBody(detail)).toMatchObject({
      message: {
        id: messageId,
        status: "delivered",
        redacted: true,
      },
    });

    const wallet = await app.inject({
      method: "GET",
      url: "/v1/wallet",
      headers,
    });
    expect(wallet.statusCode).toBe(200);
    const walletBody = jsonBody(wallet) as {
      balances: Array<{ balance: { currency: string; minor: string } }>;
      ledger: Array<{
        type: string;
        direction: string;
        amount: { minor: string };
        runningBalance: { minor: string };
      }>;
    };
    expect(walletBody.balances).toContainEqual({
      balance: {
        currency: "GHS",
        minor: (FUNDING_MINOR - cost).toString(),
      },
    });
    expect(walletBody.ledger[0]).toMatchObject({
      type: "sms_charge",
      direction: "debit",
      amount: { minor: cost.toString() },
      runningBalance: { minor: (FUNDING_MINOR - cost).toString() },
    });
  });

  it("does not expose a message to another application environment in the same tenant", async () => {
    const headers = { authorization: `Bearer ${OTHER_RAW}` };
    const messages = await app.inject({
      method: "GET",
      url: "/v1/messages",
      headers,
    });
    expect(messages.statusCode).toBe(200);
    expect((jsonBody(messages) as { messages: unknown[] }).messages).toEqual(
      [],
    );

    const detail = await app.inject({
      method: "GET",
      url: `/v1/sms/${messageId}`,
      headers,
    });
    expect(detail.statusCode).toBe(404);
  });

  it("database constraints reject a key whose environment belongs to another application", async () => {
    await expect(
      owner.unsafe(
        `INSERT INTO api_keys (
           tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
         ) VALUES ($1, $2, $3, 'sk_test_mismatch', $4, 'test', '[]'::jsonb, 'active')`,
        [
          TENANT,
          APPLICATION,
          OTHER_ENVIRONMENT,
          hashApiKey(`sk_test_${"a".repeat(40)}`),
        ],
      ),
    ).rejects.toThrow();
  });

  it("8. a provider-rejected send refunds the reservation — customer nets to zero for that send", async () => {
    const customerBefore = await balance("customer");
    const revenueBefore = await balance("revenue");

    const res = await app.inject({
      method: "POST",
      url: "/v1/sms/messages",
      headers: {
        authorization: `Bearer ${ACTIVE_RAW}`,
        "content-type": "application/json",
      },
      payload: {
        to: "+999900000005", // magic MSISDN → FakeProvider 'reject' (send returns failed at submit)
        sender_id: "JOJO",
        body: "this send will be refused by the provider",
        currency: CURRENCY,
      },
    });

    expect(res.statusCode).toBe(201);
    expect((jsonBody(res) as { status: string }).status).toBe("failed");
    // reserve-then-refund nets to zero: customer restored, nothing parked, no revenue recognized.
    expect(await balance("customer")).toBe(customerBefore);
    expect(await balance("reserved_clearing")).toBe(0n);
    expect(await balance("revenue")).toBe(revenueBefore);
  });

  it("9. the ledger invariants hold across the whole run (trial balance + projection integrity)", async () => {
    // every transaction balances: Σ(credit − debit) = 0 per txn (double-entry).
    const imbalanced = (await owner.unsafe(
      `SELECT txn_id FROM ledger_entries WHERE tenant_id = $1
       GROUP BY txn_id
       HAVING SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE -amount_minor END) <> 0`,
      [TENANT],
    )) as Array<{ txn_id: string }>;
    expect(imbalanced).toEqual([]);

    // every account's cached balance equals the signed sum of its legs (projection never drifted).
    const drifted = (await owner.unsafe(
      `SELECT a.id FROM ledger_accounts a
       LEFT JOIN ledger_entries e ON e.account_id = a.id
       WHERE a.tenant_id = $1
       GROUP BY a.id, a.balance_minor
       HAVING a.balance_minor <> COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE -e.amount_minor END), 0)`,
      [TENANT],
    )) as Array<{ id: string }>;
    expect(drifted).toEqual([]);
  });
});
