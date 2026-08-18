// ============================================================================================
// B1 — statement export against real ledger data. THE assertion: the CSV's lines sum exactly
// to closing − opening, and closing equals the live cached balance — auditable by
// construction, not by trust. tier: test:integration.
// ============================================================================================

import { unwrapEnvelope } from "@app/contracts";
import { createAppDb } from "@app/db";
import { credit, refund, reserve } from "@app/wallet";
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
    "statement integration needs DATABASE_URL_SUPER + DATABASE_URL_APP",
  );
}
process.env.DATABASE_URL_APP = APP_URL;
process.env.REDIS_QUEUE_URL = "";

const TENANT = "abcdabcd-7777-4777-8777-000000000b10";
// Unique to THIS spec: api_keys hashes are globally unique, so two specs sharing a raw key race
// on uniq_api_key_hash and authenticate as each other's tenant (sms-batch used "4".repeat(40)).
const KEY = `sk_test_${"9".repeat(40)}`;

const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 2 });
let app: NestFastifyApplication;

beforeAll(async () => {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug, plan) VALUES ($1, 'Statement Co', $2, 'sandbox') ON CONFLICT (id) DO NOTHING",
    [TENANT, `statement-co-${TENANT.slice(0, 8)}`],
  );
  await owner.unsafe(
    `INSERT INTO api_keys (tenant_id, prefix, key_hash, env, scopes, status)
     VALUES ($1, 'sk_test_stmt', $2, 'test', '["wallet:read"]'::jsonb, 'active')
     ON CONFLICT (key_hash) DO NOTHING`,
    [TENANT, hashApiKey(KEY)],
  );
  // Real movement history: top-up 10,000 → reserve 300 (parked) → refund it → reserve 250 (kept
  // parked). Customer-account legs: +10000, −300, +300, −250 → closing 9,750.
  await db.withTenant(TENANT, async (tx) => {
    await credit(tx, {
      currency: "GHS",
      amountMinor: 10_000n,
      idempotencyKey: "topup:stmt-seed",
    });
    await reserve(tx, {
      currency: "GHS",
      amountMinor: 300n,
      idempotencyKey: "reserve:stmt-a",
      referenceId: "cccccccc-0000-4000-8000-000000000001",
    });
    await refund(tx, {
      idempotencyKey: "refund:stmt-a",
      referenceId: "cccccccc-0000-4000-8000-000000000001",
    });
    await reserve(tx, {
      currency: "GHS",
      amountMinor: 250n,
      idempotencyKey: "reserve:stmt-b",
      referenceId: "cccccccc-0000-4000-8000-000000000002",
    });
  });
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

describe("statement export (B1)", () => {
  it("CSV lines sum exactly to closing − opening, and closing matches the live balance", async () => {
    const res = await app.inject({
      method: "GET",
      // An EXPLICIT window instead of the default "up to now". The seeded entries are stamped by
      // Postgres `now()` while the default `to` comes from the api process's clock, so any skew
      // between the database and the host (tens of ms here, and it drifts either way) can place the
      // seed rows just past `to` and empty the statement — a flake with nothing to do with the code
      // under test. The assertions below are unaffected: `from` predates the seed, so opening is
      // still 0 and every seeded movement still falls inside the window.
      url: `/v1/wallet/statement?currency=GHS&from=2026-07-01T00:00:00Z&to=${new Date(
        Date.now() + 86_400_000,
      ).toISOString()}`,
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const lines = res.body.trim().split("\n");
    const header = lines[0];
    expect(header).toBe(
      "timestamp,type,direction,amount_minor,currency,reference,running_balance_minor",
    );
    const parse = (line: string) => line.split(",");
    const opening = parse(lines[1] ?? "");
    const closing = parse(lines[lines.length - 1] ?? "");
    expect(opening[1]).toBe("opening_balance");
    expect(closing[1]).toBe("closing_balance");

    const openingMinor = BigInt(opening[6] ?? "0");
    const closingMinor = BigInt(closing[6] ?? "0");
    let sum = 0n;
    for (const line of lines.slice(2, -1)) {
      const cols = parse(line);
      const amount = BigInt(cols[3] ?? "0");
      sum += cols[2] === "credit" ? amount : -amount;
    }
    // The audit identity: opening + sum(lines) === closing.
    expect(openingMinor + sum).toBe(closingMinor);
    if (closingMinor !== 9_750n) {
      const entries = await owner.unsafe(
        "SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id = $1",
        [TENANT],
      );
      const txns = await owner.unsafe(
        "SELECT idempotency_key, created_at FROM ledger_transactions WHERE tenant_id = $1",
        [TENANT],
      );
      const key = await owner.unsafe(
        "SELECT tenant_id, prefix FROM api_keys WHERE key_hash = $1",
        [hashApiKey(KEY)],
      );
      console.error(
        "STATEMENT DIAG entries:",
        JSON.stringify(entries),
        "txns:",
        JSON.stringify(txns),
        "key:",
        JSON.stringify(key),
        "body:",
        res.body.slice(0, 400),
      );
    }
    expect(closingMinor).toBe(9_750n);

    // And closing equals the LIVE cached balance (maintained by the write-time trigger).
    const balanceRows = (await owner.unsafe(
      "SELECT balance_minor::text AS b FROM ledger_accounts WHERE tenant_id = $1 AND kind = 'customer' AND currency = 'GHS'",
      [TENANT],
    )) as Array<{ b: string }>;
    expect(BigInt(balanceRows[0]?.b ?? "0")).toBe(closingMinor);

    // References ride every movement line — the support/dispute handle.
    const movementLines = lines.slice(2, -1);
    expect(movementLines.some((l) => l.includes("cccccccc-0000-"))).toBe(true);
  });

  it("rejects an inverted period with a structured error", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/wallet/statement?from=2026-07-10T00:00:00Z&to=2026-07-01T00:00:00Z",
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(res.statusCode).toBe(400);
    expect(
      (unwrapEnvelope(res.json()) as { error: { code: string } }).error.code,
    ).toBe("invalid_period");
  });
});
