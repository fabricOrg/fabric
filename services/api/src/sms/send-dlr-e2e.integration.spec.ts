// ============================================================================================
// WALKING-SKELETON CAPSTONE (E2E) — the whole thin thread, end to end, over real HTTP + real DB.
// tier: test:integration. Boots the ACTUAL NestJS+Fastify app (AppModule → ApiKeyGuard, SmsService
// with the DI'd FakeProvider, DbModule on the app_runtime pool), drives it via Fastify `.inject()`,
// and asserts the MONEY is correct at the ledger — not just that the HTTP call returned 2xx.
//
// This is the capstone the WS iteration was built toward: authed tenant-scoped SMS send with a
// correct double-entry money ledger on FakeProvider. It proves the layers compose:
//   L2 api-key auth → L5 send pipeline → L3 wallet reserve/commit/refund → write-time ledger triggers.
//
// THE 9 STEPS (F5 demo):
//   1. migrate DB as app_migrator (harness, before this tier runs)
//   2. seed a tenant + an ACTIVE sk_test_ key (superuser, cross-tenant)
//   3. fund the customer wallet via a REAL double-entry top-up (credit) — never a hand-set balance,
//      so the ledger invariant holds from the start
//   4. boot the real app (FakeProvider wired) + inject HTTP
//   5. POST /v1/sms/send with the key → 201 {id,status:'accepted'}
//   6. assert money moved EXACTLY ONCE: customer ↓ cost, reserved_clearing = 0, revenue = cost
//      (committed at 'accepted' — honest-billing)
//   7. POST /webhooks/dlr/fake-sms {delivered} → 200; assert balances UNCHANGED (post-commit DLR is a
//      no-op for money — decideResolution → 'none', S4-family)
//   8. a REJECT send (magic MSISDN) → provider refuses at submit → REFUND; assert customer net-zero,
//      reserved_clearing = 0, revenue unchanged (money returned exactly once)
//   9. assert the ledger invariants hold across everything: every txn balances (Σ signed legs = 0)
//      and every account's balance_minor = Σ its legs (projection never drifted)
//
// Env (same harness as the other integration specs): DATABASE_URL_SUPER (app_owner superuser — seeds
// cross-tenant + reads balances, bypasses FORCE RLS), DATABASE_URL_APP (app_runtime — what the app
// connects as, RLS-enforced). DB migrated as DATABASE_URL_OWNER (app_migrator) first.
// ============================================================================================

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

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "send-dlr-e2e needs DATABASE_URL_SUPER + DATABASE_URL_APP (a fresh DB migrated as app_migrator)",
  );
}
// The app's DbModule reads DATABASE_URL_APP off the environment — ensure the factory sees it.
process.env.DATABASE_URL_APP = APP_URL;

// Distinct tenant id so this spec's rows never collide with the other integration specs' fixtures.
const TENANT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ACTIVE_RAW = `sk_test_${"e".repeat(40)}`;
const CURRENCY = "GHS";
const FUNDING_MINOR = 100_000n; // 1,000.00 GHS in pesewas — plenty for a few 3-pesewa segments

const owner = postgres(SUPER_URL, { max: 2 }); // superuser: seed + read balances (bypasses FORCE RLS)
const db = createAppDb(APP_URL, { max: 2 }); // app_runtime: RLS-enforced (used to fund via withTenant)
let app: NestFastifyApplication;

interface BalRow {
  b: string;
}
/** A ledger account's cached balance for this tenant+currency (0 if the account doesn't exist yet). */
async function balance(kind: string): Promise<bigint> {
  const rows = (await owner.unsafe(
    "SELECT COALESCE(balance_minor, 0)::text AS b FROM ledger_accounts WHERE tenant_id = $1 AND kind = $2 AND currency = $3",
    [TENANT, kind, CURRENCY],
  )) as BalRow[];
  return rows[0] ? BigInt(rows[0].b) : 0n;
}

beforeAll(async () => {
  // 2. tenant + active key. key_hash uses the SAME hashApiKey the service computes → possession match.
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, 'Tenant E', 'tenant-e') ON CONFLICT (id) DO NOTHING",
    [TENANT],
  );
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, 'sk_test_e2e', $2, 'test', '["sms:send"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [TENANT, hashApiKey(ACTIVE_RAW)],
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

  // 4. boot the real app (FakeProvider is DI'd inside SmsService); inject HTTP, no network port.
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
  await owner.unsafe("DELETE FROM api_keys WHERE tenant_id = $1", [TENANT]);
  await owner.unsafe("DELETE FROM accounts WHERE id = $1", [TENANT]);
  await owner.end();
  await db.end();
});

describe("walking-skeleton capstone: authed send → DLR → correct money (E2E)", () => {
  let messageId: string;
  let cost: bigint;

  it("5+6. POST /v1/sms/send with a valid key charges the customer exactly once (committed at accepted)", async () => {
    const funded = await balance("customer");
    expect(funded).toBe(FUNDING_MINOR); // seed landed via the ledger, not a hand-set balance

    const res = await app.inject({
      method: "POST",
      url: "/v1/sms/send",
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
    const json = res.json() as {
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

  it("7. POST /webhooks/dlr/fake-sms {delivered} is accepted and does NOT move money again", async () => {
    const customerBefore = await balance("customer");
    const revenueBefore = await balance("revenue");

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/dlr/fake-sms",
      headers: { "content-type": "application/json" },
      payload: {
        providerRef: `fake-${messageId}`, // deterministic ref the provider assigned at 'accepted'
        status: "delivered",
        occurredAt: "1970-01-01T00:00:00.000Z",
        segments: 1,
      },
    });

    expect(res.statusCode).toBe(201);
    expect((res.json() as { status: string }).status).toBe("delivered");
    // post-commit DLR is a no-op for money (decideResolution → 'none'): balances unchanged.
    expect(await balance("customer")).toBe(customerBefore);
    expect(await balance("revenue")).toBe(revenueBefore);
    expect(await balance("reserved_clearing")).toBe(0n);
  });

  it("8. a provider-rejected send refunds the reservation — customer nets to zero for that send", async () => {
    const customerBefore = await balance("customer");
    const revenueBefore = await balance("revenue");

    const res = await app.inject({
      method: "POST",
      url: "/v1/sms/send",
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
    expect((res.json() as { status: string }).status).toBe("failed");
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
