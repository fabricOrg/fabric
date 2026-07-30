import { randomUUID } from "node:crypto";
import { createAppDb, createProvisioningDb } from "@app/db";
import { credit } from "@app/wallet";
import type { Logger } from "@nestjs/common";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runGlPostingDrain } from "../maintenance/maintenance-gl-posting.js";

/**
 * Gate for the AIRLOCK SEAM itself (ADR-0013 #10, slice 1b), as opposed to whether movements mirror
 * correctly — that is gl-posting.integration.spec.ts.
 *
 * These are the assertions that fail if 0114's REVOKE or its INSERT-only policy is ever dropped. They
 * exist because every assertion in the sibling spec reads through the superuser owner, which bypasses
 * RLS entirely: without this file you could delete `REVOKE ALL ... FROM app_runtime` and the whole
 * suite would stay green.
 */

const SUPER_URL =
  process.env.DATABASE_URL_SUPER ?? process.env.DATABASE_URL_OWNER;
const APP_URL = process.env.DATABASE_URL_APP;
const PROV_URL = process.env.DATABASE_URL_PROVISIONER;
if (!SUPER_URL || !APP_URL || !PROV_URL) {
  throw new Error(
    "gl posting seam gate requires DATABASE_URL_SUPER + DATABASE_URL_APP + DATABASE_URL_PROVISIONER",
  );
}

const owner = postgres(SUPER_URL, { max: 2, onnotice: () => {} });
const runtime = postgres(APP_URL, { max: 1, onnotice: () => {} });
const app = createAppDb(APP_URL, { max: 2 });
const provisioning = createProvisioningDb(PROV_URL);

const TENANT = randomUUID();
const CCY = "GHS";
type Row = Record<string, unknown>;

async function requestCount(ledgerTxnId: string): Promise<number> {
  const rows = (await owner`
    SELECT count(*)::int AS count FROM gl_posting_requests
    WHERE ledger_txn_id = ${ledgerTxnId}`) as Row[];
  return Number(rows[0]?.count);
}

const topUp = (amount: bigint) =>
  app.withTenant(TENANT, (tx) =>
    credit(tx, {
      currency: CCY,
      amountMinor: amount,
      idempotencyKey: `topup:${randomUUID()}`,
    }),
  );

describe("the GL posting airlock seam", () => {
  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug, plan)
      VALUES (${TENANT}, ${`gl-seam-${TENANT}`}, ${`gl-seam-${TENANT.slice(0, 8)}`}, 'sandbox')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM accounts WHERE id = ${TENANT}`;
    await Promise.allSettled([
      owner.end(),
      runtime.end(),
      app.end(),
      provisioning.end(),
    ]);
  });

  it("denies app_runtime everything but INSERT on the queue", async () => {
    for (const statement of [
      "SELECT 1 FROM gl_posting_requests LIMIT 1",
      "UPDATE gl_posting_requests SET status = 'posted'",
      "DELETE FROM gl_posting_requests",
    ]) {
      await expect(runtime.unsafe(statement)).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("refuses an enqueue that claims another tenant", async () => {
    const other = randomUUID();
    const movement = await topUp(100n);
    await expect(
      runtime.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
        await tx`
          INSERT INTO gl_posting_requests
            (tenant_id, ledger_txn_id, currency, event_time, legs)
          VALUES (${other}, ${movement.txnId}, ${CCY}, now(),
                  ${tx.json([{ a: 1 }, { b: 2 }])})`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("enqueues nothing for a movement whose transaction rolls back", async () => {
    let attempted: string | null = null;
    await expect(
      app.withTenant(TENANT, async (tx) => {
        const posted = await credit(tx, {
          currency: CCY,
          amountMinor: 100n,
          idempotencyKey: `topup:${randomUUID()}`,
        });
        attempted = posted.txnId;
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow(/deliberate rollback/);

    expect(attempted).not.toBeNull();
    // The deferred trigger's event dies with the transaction, so there is no phantom request — and no
    // ledger transaction either.
    expect(await requestCount(String(attempted))).toBe(0);
    const txns = (await owner`
      SELECT 1 FROM ledger_transactions WHERE id = ${String(attempted)}`) as Row[];
    expect(txns).toHaveLength(0);
  });

  it("drains through the production caller, not just the library function", async () => {
    // The repo's rule: a queued job needs a production caller AND a test that drives that caller. This
    // drives the body the @Cron tick calls.
    const movement = await topUp(1300n);
    const logged: string[] = [];
    const logger = {
      error: (m: string) => logged.push(`error:${m}`),
      warn: (m: string) => logged.push(`warn:${m}`),
      log: (m: string) => logged.push(`log:${m}`),
    } as unknown as Logger;

    const ran = await runGlPostingDrain({
      db: provisioning.db,
      enabled: true,
      logger,
    });
    expect(ran).not.toBeNull();

    const rows = (await owner`
      SELECT status, posted_journal_id FROM gl_posting_requests
      WHERE ledger_txn_id = ${movement.txnId}`) as Row[];
    expect(String(rows[0]?.status)).toBe("posted");
    expect(rows[0]?.posted_journal_id).not.toBeNull();
  });

  it("stops draining on the documented kill path without losing queued work", async () => {
    const movement = await topUp(1400n);
    const logger = {
      error: () => {},
      warn: () => {},
      log: () => {},
    } as unknown as Logger;

    expect(
      await runGlPostingDrain({
        db: provisioning.db,
        enabled: false,
        logger,
      }),
    ).toBeNull();

    // Still queued, not lost: the enqueue trigger is unaffected by the kill switch, so turning posting
    // back on drains the backlog.
    const rows = (await owner`
      SELECT status FROM gl_posting_requests WHERE ledger_txn_id = ${movement.txnId}`) as Row[];
    expect(String(rows[0]?.status)).toBe("pending");

    await runGlPostingDrain({ db: provisioning.db, enabled: true, logger });
    const after = (await owner`
      SELECT status FROM gl_posting_requests WHERE ledger_txn_id = ${movement.txnId}`) as Row[];
    expect(String(after[0]?.status)).toBe("posted");
  });
});
