// ============================================================================================
// @app/sms-engine — send-pipeline integration gate (L5, newton). tier: test:integration.
// Drives the full money thread through the real RLS runtime + ledger: normalize→segment→rate→
// reserve→send→commit/refund, DLR reconcile (out-of-order tolerant), and the TTL sweeper. Uses a
// local SmsSenderPlugin double (adams' FakeProvider lands separately; this proves the ENGINE). Asserts
// message status + wallet balances + trial-balance/projection after every scenario (S1/S3/S4/S6 + OOO).
// ============================================================================================

import { createAppDb } from "@app/db";
import type {
  CanonicalDlr,
  ProviderResult,
  SmsSenderPlugin,
} from "@app/integrations";
import { credit } from "@app/wallet";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ingestDlr, sendSms, sweepExpired } from "../src/index.js";

// Seed/sweep as the TEST-ONLY SUPERUSER (DATABASE_URL_SUPER): post prod-faithful role model (653b45d)
// the owner is NON-super app_migrator, which FORCE RLS constrains like prod → it cannot INSERT into
// accounts without tenant context. Superuser bypasses RLS for fixtures. Falls back to OWNER locally.
const SUPER_URL =
  process.env.DATABASE_URL_SUPER ?? process.env.DATABASE_URL_OWNER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "test:integration requires DATABASE_URL_SUPER (or _OWNER) + DATABASE_URL_APP",
  );
}

const TENANT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 5 });
type Row = Record<string, unknown>;

// Local SmsSenderPlugin double — send() outcome keyed by the recipient string; parseDlr echoes a
// canonical payload. providerRef = ref-{messageId} so it's unique per message (uniq index) and the
// DLR can correlate. billableStatuses:['accepted'] → commit-on-accepted honest billing.
const provider: SmsSenderPlugin = {
  slug: "fake-sms",
  capability: "sms",
  version: "0.0.0",
  supports: () => true,
  configSchema: {},
  healthCheck: async () => ({ status: "up" }),
  billableStatuses: ["accepted"],
  platformFaultExemptions: [
    "internal_error",
    "suspension",
    "fraud_block",
    "geo_block",
  ],
  send: async (msg): Promise<ProviderResult> => {
    if (msg.to.includes("reject")) return { status: "failed" };
    if (msg.to.includes("noack")) return { status: "sending" }; // S6 — no ref
    return { status: "accepted", providerRef: `ref-${msg.messageId}` };
  },
  parseDlr: (payload): CanonicalDlr => payload as CanonicalDlr,
  verifyWebhook: () => true,
};
const deps = { db, provider };

async function balances(): Promise<Record<string, bigint>> {
  const rows = (await owner`
    SELECT kind, balance_minor FROM ledger_accounts WHERE tenant_id = ${TENANT}`) as Row[];
  const out: Record<string, bigint> = {};
  for (const r of rows) out[String(r.kind)] = BigInt(String(r.balance_minor));
  return out;
}
async function statusOf(messageId: string): Promise<string> {
  const rows =
    (await owner`SELECT status FROM messages WHERE id = ${messageId}`) as Row[];
  return String(rows[0]?.status);
}
async function assertInvariants(): Promise<void> {
  const bad = (await owner`
    SELECT txn_id FROM ledger_entries WHERE tenant_id = ${TENANT} GROUP BY txn_id
    HAVING SUM(CASE direction WHEN 'credit' THEN amount_minor ELSE -amount_minor END) <> 0`) as Row[];
  expect(bad, "every txn balanced").toEqual([]);
  const drift = (await owner`
    SELECT a.id FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
    WHERE a.tenant_id = ${TENANT} GROUP BY a.id, a.balance_minor
    HAVING a.balance_minor <> COALESCE(SUM(CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END),0)`) as Row[];
  expect(drift, "every projection = SUM(legs)").toEqual([]);
}

beforeAll(async () => {
  await owner`INSERT INTO accounts (id, name, slug) VALUES (${TENANT}, 'SMS Test', 'sms-test') ON CONFLICT (id) DO NOTHING`;
});
afterEach(async () => {
  await owner`DELETE FROM messages WHERE tenant_id = ${TENANT}`;
  await owner`DELETE FROM ledger_entries WHERE tenant_id = ${TENANT}`;
  await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${TENANT}`;
  await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${TENANT}`;
});
afterAll(async () => {
  await owner`DELETE FROM accounts WHERE id = ${TENANT}`;
  await Promise.all([owner.end(), db.end()]);
});

async function topup(amount: bigint): Promise<void> {
  await db.withTenant(TENANT, (tx) =>
    credit(tx, {
      currency: "GHS",
      amountMinor: amount,
      idempotencyKey: `topup:${amount}:${Math.random()}`,
    }),
  );
}
const send = (to: string, body = "hi") =>
  sendSms(deps, {
    tenantId: TENANT,
    to,
    senderId: "BRAND",
    body,
    currency: "GHS",
  });

describe("send pipeline — money thread", () => {
  it("S1: send→accepted commits on accepted; DLR delivered leaves it billed", async () => {
    await topup(1000n);
    const { messageId, status } = await send("accept-1");
    expect(status).toBe("accepted");
    let b = await balances();
    expect(b.customer).toBe(997n); // 1000 − 3 (1 segment × 3)
    expect(b.revenue).toBe(3n); // committed on accepted
    expect(b.reserved_clearing).toBe(0n);
    await assertInvariants();

    const s = await ingestDlr(deps, TENANT, {
      providerRef: `ref-${messageId}`,
      status: "delivered",
    });
    expect(s).toBe("delivered");
    b = await balances();
    expect(b.customer).toBe(997n); // unchanged — already billed
    expect(b.revenue).toBe(3n);
    expect(await statusOf(messageId)).toBe("delivered");
    await assertInvariants();
  });

  it("S3: reject-at-submit refunds — never billed", async () => {
    await topup(1000n);
    const { messageId, status } = await send("reject-1");
    expect(status).toBe("failed");
    const b = await balances();
    expect(b.customer).toBe(1000n); // fully restored
    expect(b.reserved_clearing).toBe(0n);
    expect(b.revenue ?? 0n).toBe(0n);
    expect(await statusOf(messageId)).toBe("failed");
    await assertInvariants();
  });

  it("S6: no-ack (sending) → sweeper refunds the never-billable reservation", async () => {
    await topup(1000n);
    const { messageId, status } = await send("noack-1");
    expect(status).toBe("sending");
    let b = await balances();
    expect(b.customer).toBe(997n); // reserved (parked), not yet resolved
    expect(b.reserved_clearing).toBe(3n);
    // sweep everything (future cutoff)
    const swept = await sweepExpired(deps, TENANT, "2999-01-01T00:00:00Z");
    expect(swept).toBe(1);
    b = await balances();
    expect(b.customer).toBe(1000n); // refunded — never reached billable
    expect(b.reserved_clearing).toBe(0n);
    expect(await statusOf(messageId)).toBe("expired");
    await assertInvariants();
  });

  it("S4: accepted then no DLR → sweeper expires but stays billed (no refund)", async () => {
    await topup(1000n);
    const { messageId } = await send("accept-2");
    const swept = await sweepExpired(deps, TENANT, "2999-01-01T00:00:00Z");
    expect(swept).toBe(1);
    const b = await balances();
    expect(b.customer).toBe(997n); // stays billed — provider took it
    expect(b.revenue).toBe(3n);
    expect(b.reserved_clearing).toBe(0n);
    expect(await statusOf(messageId)).toBe("expired");
    await assertInvariants();
  });

  it("out-of-order + idempotent DLRs: terminal freezes; stale/lower ignored; no double-commit", async () => {
    await topup(1000n);
    const { messageId } = await send("accept-3");
    await ingestDlr(deps, TENANT, {
      providerRef: `ref-${messageId}`,
      status: "delivered",
    });
    // a stale lower-rank DLR must NOT regress a terminal status
    const s2 = await ingestDlr(deps, TENANT, {
      providerRef: `ref-${messageId}`,
      status: "sent",
    });
    expect(s2).toBe("delivered");
    // a duplicate delivered DLR must not double-commit
    await ingestDlr(deps, TENANT, {
      providerRef: `ref-${messageId}`,
      status: "delivered",
    });
    const b = await balances();
    expect(b.customer).toBe(997n);
    expect(b.revenue).toBe(3n); // committed exactly once
    expect(await statusOf(messageId)).toBe("delivered");
    await assertInvariants();
  });
});
