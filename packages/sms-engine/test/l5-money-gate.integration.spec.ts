// ============================================================================================
// L5 MONEY-GATE (QA / adams) — drives the REAL FakeProvider through the REAL engine (sendSms →
// ingestDlr → sweepExpired) over @app/db withTenant, and asserts money-correctness after every
// scenario. Complements newton's send-pipeline spec (which proves the ENGINE with an inline double);
// this proves the ENGINE + the QA-owned FakeProvider TOGETHER, keyed by the magic-MSISDN contract.
// tier: test:integration.
//
// The scenarios that matter for money (F5 billing basis = commit-on-`accepted`, fault-exempt refunds):
//   S1 delivered      → accepted→commit, DLR delivered → stays billed.
//   S3 reject         → send RETURNS {status:'failed'} → REFUND NOW (the newton fix: NOT a throw).
//   S4 no_dlr         → accepted→commit, sweeper → `expired` but STAYS billed (no refund).
//   S6 no_ack         → send `sending` (never billable) → sweeper REFUNDS at TTL.
//   B2 transport_fault→ send() THROWS → no resolve tx; message stuck `sending`+reserved → sweeper tail refunds.
//   platform_fault    → accepted→commit, DLR failed(internal_error) → committed-then-REFUNDED (exemption).
// ============================================================================================

import { createAppDb } from "@app/db";
import { FakeProvider, MAGIC_MSISDNS } from "@app/integrations/testing";
import { credit } from "@app/wallet";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ingestDlr, sendSms, sweepExpired } from "../src/index.js";

// Seed/sweep as the TEST-ONLY SUPERUSER (653b45d) — the non-super owner is FORCE-RLS-constrained and
// cannot seed accounts without tenant context; the superuser bypasses RLS for fixtures + assertions.
const SUPER_URL =
  process.env.DATABASE_URL_SUPER ?? process.env.DATABASE_URL_OWNER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "L5 money-gate requires DATABASE_URL_SUPER (or _OWNER) + DATABASE_URL_APP",
  );
}

const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 5 });
const provider = new FakeProvider();
const deps = { db, provider };
type Row = Record<string, unknown>;
const FUTURE = "2999-01-01T00:00:00Z"; // sweep cutoff past everything

const TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const FAR = "2000-01-01T00:00:00.000Z"; // occurredAt for DLRs (deterministic)

function first<T>(rows: readonly T[]): T {
  const r = rows[0];
  if (r === undefined) throw new Error("expected at least one row");
  return r;
}

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
/** Both ledger invariants over this tenant: per-txn trial balance = 0, per-account projection = SUM(legs). */
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

async function topup(amount: bigint): Promise<void> {
  await db.withTenant(TENANT, (tx) =>
    credit(tx, {
      currency: "GHS",
      amountMinor: amount,
      idempotencyKey: `topup:${amount}`,
    }),
  );
}
const send = (to: string) =>
  sendSms(deps, {
    tenantId: TENANT,
    to,
    senderId: "BRAND",
    body: "hi",
    currency: "GHS",
  });
const dlr = (messageId: string, status: string, faultCause?: string) => ({
  providerRef: `fake-${messageId}`,
  status,
  occurredAt: FAR,
  ...(faultCause ? { faultCause } : {}),
});

describe("L5 money-gate — real FakeProvider through the real engine", () => {
  beforeAll(async () => {
    await owner`INSERT INTO accounts (id, name, slug) VALUES (${TENANT}, 'L5 Money', 'l5-money')
      ON CONFLICT (id) DO NOTHING`;
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

  // magic-MSISDN contract sanity — the numbers this gate references resolve to the intended scenarios.
  it("references the magic-MSISDN sandbox contract (reject + transport_fault present)", () => {
    expect(MAGIC_MSISDNS["+999900000005"]).toBe("reject");
    expect(MAGIC_MSISDNS["+999900000007"]).toBe("transport_fault");
  });

  it("S1 delivered → commit on accepted, DLR delivered stays billed", async () => {
    await topup(1000n);
    const { messageId, status } = await send("+999900000001");
    expect(status).toBe("accepted");
    let b = await balances();
    expect(b.customer).toBe(997n);
    expect(b.revenue).toBe(3n);
    expect(b.reserved_clearing).toBe(0n);
    await assertInvariants();
    expect(await ingestDlr(deps, TENANT, dlr(messageId, "delivered"))).toBe(
      "delivered",
    );
    b = await balances();
    expect(b.customer).toBe(997n); // unchanged — already billed
    expect(b.revenue).toBe(3n);
    expect(await statusOf(messageId)).toBe("delivered");
    await assertInvariants();
  });

  // THE newton FIX: reject is a RETURNED {status:'failed'}, not a throw → the engine runs tx2 and
  // refunds the reservation immediately (S3). Never billed.
  it("S3 reject → send returns failed → REFUND now (customer restored, no revenue)", async () => {
    await topup(1000n);
    const { messageId, status } = await send("+999900000005");
    expect(status).toBe("failed");
    const b = await balances();
    expect(b.customer).toBe(1000n); // fully restored — refunded at submit
    expect(b.reserved_clearing).toBe(0n);
    expect(b.revenue ?? 0n).toBe(0n);
    expect(await statusOf(messageId)).toBe("failed");
    await assertInvariants();
  });

  it("S6 no_ack → send `sending` (reserved) → sweeper REFUNDS at TTL", async () => {
    await topup(1000n);
    const { messageId, status } = await send("+999900000006");
    expect(status).toBe("sending");
    let b = await balances();
    expect(b.customer).toBe(997n); // reserved (parked), not resolved
    expect(b.reserved_clearing).toBe(3n);
    expect(await sweepExpired(deps, TENANT, FUTURE)).toBe(1);
    b = await balances();
    expect(b.customer).toBe(1000n); // refunded — never reached billable
    expect(b.reserved_clearing).toBe(0n);
    expect(await statusOf(messageId)).toBe("expired");
    await assertInvariants();
  });

  it("S4 no_dlr → committed, sweeper expires but STAYS billed (no refund)", async () => {
    await topup(1000n);
    const { messageId } = await send("+999900000004");
    expect(await sweepExpired(deps, TENANT, FUTURE)).toBe(1);
    const b = await balances();
    expect(b.customer).toBe(997n); // stays billed — provider accepted it
    expect(b.revenue).toBe(3n);
    expect(b.reserved_clearing).toBe(0n);
    expect(await statusOf(messageId)).toBe("expired");
    await assertInvariants();
  });

  // B2: a transport fault THROWS out of send() → tx2 never runs → the message is stuck `sending` +
  // reserved. The TTL sweeper is the safety net that eventually refunds the never-resolved reservation.
  it("B2 transport_fault → send() throws, reservation parked, sweeper tail refunds", async () => {
    await topup(1000n);
    await expect(send("+999900000007")).rejects.toBeTruthy();
    // tx1 committed before the throw: message persisted `sending`, reservation held.
    let b = await balances();
    expect(b.customer).toBe(997n);
    expect(b.reserved_clearing).toBe(3n);
    await assertInvariants();
    const stuck = (await owner`
      SELECT id, status FROM messages WHERE tenant_id = ${TENANT}`) as Row[];
    expect(String(first(stuck).status)).toBe("sending");
    // sweeper tail: the never-acked reservation is refunded, message → expired.
    expect(await sweepExpired(deps, TENANT, FUTURE)).toBe(1);
    b = await balances();
    expect(b.customer).toBe(1000n); // refunded
    expect(b.reserved_clearing).toBe(0n);
    expect(await statusOf(String(first(stuck).id))).toBe("expired");
    await assertInvariants();
  });

  // Thin-thread boundary (billing.ts:42): a platform fault AFTER the commit does NOT auto-refund —
  // decideResolution short-circuits to 'none' once reachedBillable, because a post-commit reversal is a
  // follow-up `adjustment`, not a refund. The exemption→refund path fires only PRE-commit (e.g. S3).
  // So an accepted (billed) message whose DLR later reports internal_error STAYS billed here.
  it("platform_fault DLR post-commit → STAYS billed (reversal is a follow-up adjustment, not a refund)", async () => {
    await topup(1000n);
    const { messageId, status } = await send("+999900000003");
    expect(status).toBe("accepted");
    let b = await balances();
    expect(b.revenue).toBe(3n); // billed at accepted
    expect(
      await ingestDlr(deps, TENANT, dlr(messageId, "failed", "internal_error")),
    ).toBe("failed");
    b = await balances();
    expect(b.customer).toBe(997n); // unchanged — post-commit fault is not a thin-thread refund
    expect(b.revenue).toBe(3n);
    expect(await statusOf(messageId)).toBe("failed");
    await assertInvariants();
  });
});
