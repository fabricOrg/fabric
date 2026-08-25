// ============================================================================================
// The wallet's customer-facing reads must report `accounts.billing_currency`, because it is the
// only currency a charge may be raised in and NOTHING ELSE ON THE WIRE IMPLIES IT. Both cases
// below are seeded so that every value a caller could have inferred instead is the WRONG one:
// billing is NGN while the only ledger balance is GHS and the stored auto-top-up says GHS.
//
// Driven over HTTP through the real app so response validation (strict outside production) checks
// the payload against the published contract — a controller call would bypass both. tier:
// test:integration.
// ============================================================================================

import { autoTopupResponseSchema, walletSnapshot } from "@app/contracts";
import { createAppDb } from "@app/db";
import { credit } from "@app/wallet";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "../api-keys/api-key.crypto.js";
import { AppModule } from "../app.module.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "wallet billing-currency integration needs DATABASE_URL_SUPER + DATABASE_URL_APP",
  );
}
process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = "";

const TENANT = "abcdabcd-7777-4777-8777-000000000b20";
// Unique to THIS spec: api_keys hashes are globally unique, so a shared raw key races on
// uniq_api_key_hash and authenticates as the other spec's tenant.
const KEY = `sk_test_${"8".repeat(40)}`;

const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 2 });
let app: NestFastifyApplication;

beforeAll(async () => {
  await owner.unsafe(
    `INSERT INTO accounts (id, name, slug, plan, billing_currency)
     VALUES ($1, 'Billing Currency Co', $2, 'sandbox', 'NGN')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT, `billing-cur-${TENANT.slice(0, 8)}`],
  );
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, 'sk_test_bcur', $2, 'test', '["wallet:read"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [TENANT, hashApiKey(KEY)],
  );
  // A GHS balance under NGN billing. This is the drift the old dashboard heuristic read as truth:
  // it took the currency of `balances[0]`, which is only ever the alphabetically first one.
  await db.withTenant(TENANT, async (tx) => {
    await credit(tx, {
      currency: "GHS",
      amountMinor: 10_000n,
      idempotencyKey: "topup:bcur-seed",
    });
  });
  // An auto-top-up the cron can never charge: `chargeableCurrency` returns null for a stored
  // currency that is not the billing one, logs, and skips. Inserted directly because
  // `updateAutoTopup` refuses to ENABLE a mismatch — which is how one gets stranded in the first
  // place, since the currency can change after the config was saved.
  await owner.unsafe(
    `INSERT INTO auto_topup (tenant_id, enabled, threshold_minor, top_up_minor, currency)
     VALUES ($1, true, 1000, 5000, 'GHS')
     ON CONFLICT (tenant_id) DO NOTHING`,
    [TENANT],
  );
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
  for (const table of [
    "auto_topup",
    "ledger_entries",
    "ledger_transactions",
    "ledger_accounts",
    "api_keys",
  ]) {
    await owner.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT]);
  }
  await owner.unsafe("DELETE FROM accounts WHERE id = $1", [TENANT]);
  await owner.end();
  await db.end();
});

describe("the wallet reports the workspace's billing currency", () => {
  it("GET /v1/wallet answers NGN even though the only balance is GHS", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/wallet",
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const snapshot = walletSnapshot.parse(res.json().data);
    expect(snapshot.billing_currency).toBe("NGN");
    // Pinned together: the assertion above only means something while a DIFFERENT currency is the
    // one a caller would have guessed from the balances.
    expect(snapshot.balances.map((b) => b.balance.currency)).toEqual(["GHS"]);
  });

  it("GET /v1/wallet/auto-topup makes a config that can never charge visible", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/wallet/auto-topup",
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const body = autoTopupResponseSchema.parse(res.json().data);
    // `enabled: true` and yet dead. Before the response carried `billing_currency` these two facts
    // could not be compared by any caller, so the dashboard showed a green "On" badge for a
    // top-up that had never fired and never would.
    expect(body.config?.enabled).toBe(true);
    expect(body.config?.currency).toBe("GHS");
    expect(body.billing_currency).toBe("NGN");
  });
});
