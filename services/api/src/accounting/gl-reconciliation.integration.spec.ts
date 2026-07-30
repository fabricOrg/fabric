import { randomUUID } from "node:crypto";
import {
  checkGlReconciliation,
  createAppDb,
  createProvisioningDb,
  formatReconciliation,
} from "@app/db";
import { commit, credit, reserve } from "@app/wallet";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainGlPostingRequests } from "./gl-posting.worker.js";
import { reverseGlJournal } from "./gl-reversal.js";

/**
 * The PHASE 1 EXIT GATE (ADR-0013 #15, roadmap FIN-004): the two ledgers must AGREE, not merely each
 * be internally consistent.
 *
 * A reconciliation that only ever passes proves nothing, so this drives it in both directions — a real
 * set of movements must reconcile, and a journal that posts the wrong amount must be caught.
 */

const SUPER_URL =
  process.env.DATABASE_URL_SUPER ?? process.env.DATABASE_URL_OWNER;
const APP_URL = process.env.DATABASE_URL_APP;
const PROV_URL = process.env.DATABASE_URL_PROVISIONER;
if (!SUPER_URL || !APP_URL || !PROV_URL) {
  throw new Error(
    "reconciliation gate requires DATABASE_URL_SUPER + DATABASE_URL_APP + DATABASE_URL_PROVISIONER",
  );
}

const owner = postgres(SUPER_URL, { max: 2, onnotice: () => {} });
const app = createAppDb(APP_URL, { max: 3 });
const provisioning = createProvisioningDb(PROV_URL);

const TENANT = randomUUID();
const CCY = "GHS";
type Row = Record<string, unknown>;

const executor = {
  query: async (q: string) => ({
    rows: (await owner.unsafe(q)) as unknown as Row[],
  }),
};

describe("subledger to control-account reconciliation", () => {
  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug, plan)
      VALUES (${TENANT}, ${`recon-${TENANT}`}, ${`recon-${TENANT.slice(0, 8)}`}, 'sandbox')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM accounts WHERE id = ${TENANT}`;
    await Promise.allSettled([owner.end(), app.end(), provisioning.end()]);
  });

  it("reconciles a full top-up, reserve and commit lifecycle", async () => {
    const message = randomUUID();
    await app.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: CCY,
        amountMinor: 5000n,
        idempotencyKey: `topup:${randomUUID()}`,
      }),
    );
    await app.withTenant(TENANT, (tx) =>
      reserve(tx, {
        currency: CCY,
        amountMinor: 300n,
        referenceId: message,
        idempotencyKey: `reserve:${message}`,
      }),
    );
    await app.withTenant(TENANT, (tx) =>
      commit(tx, { referenceId: message, idempotencyKey: `commit:${message}` }),
    );
    await drainGlPostingRequests(provisioning.db);

    const result = await checkGlReconciliation(executor);
    expect(formatReconciliation(result)).toContain("reconciles");
    expect(result.discrepancies).toEqual([]);
  });

  it("does not read normal drain lag as a discrepancy", async () => {
    // Enqueued but deliberately NOT drained. The subledger has moved and the books have not, which is
    // the steady state between ticks — reporting it would leave the gate permanently amber and nobody
    // would look at it. Completeness is invariant 3's job; this check is about accuracy.
    await app.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: CCY,
        amountMinor: 4200n,
        idempotencyKey: `topup:${randomUUID()}`,
      }),
    );

    const result = await checkGlReconciliation(executor);
    expect(result.ok).toBe(true);

    // ...and once drained it still reconciles, so the movement was not merely ignored.
    await drainGlPostingRequests(provisioning.db);
    expect((await checkGlReconciliation(executor)).ok).toBe(true);
  });

  it("refuses to call blindness agreement", async () => {
    /**
     * The failure mode this guard exists for: `ledger_entries`, `ledger_accounts` and `accounts` are all
     * FORCE RLS with permissive policies naming `app_provisioner` only, so a caller that is neither
     * superuser nor that role — with no `app.tenant_id` set — scans ZERO rows and would otherwise be
     * told the ledgers reconcile. `db:assert` connects as `DATABASE_URL_OWNER`, which is a superuser
     * locally but the NON-superuser `app_migrator` in the cloud, so this is the deployed configuration,
     * not a hypothetical.
     */
    await app.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: CCY,
        amountMinor: 2500n,
        idempotencyKey: `topup:${randomUUID()}`,
      }),
    );
    await drainGlPostingRequests(provisioning.db);

    /**
     * Simulated by `SET ROLE app_migrator` on the superuser connection, which reproduces the DEPLOYED
     * configuration precisely: app_migrator owns the `gl_*` tables so it can read them, but it is
     * non-superuser, so FORCE RLS on `ledger_*` binds it and with no `app.tenant_id` it sees no legs.
     * Using `app_runtime` would not work — it holds no privilege on `gl_journals` at all, so it errors
     * rather than going quietly blind, which is the failure mode under test.
     */
    const blind = postgres(SUPER_URL, { max: 1, onnotice: () => {} });
    try {
      await blind`SET ROLE app_migrator`;
      const blindExecutor = {
        query: async (q: string) => ({
          rows: (await blind.unsafe(q)) as unknown as Row[],
        }),
      };
      const result = await checkGlReconciliation(blindExecutor);
      // Judged on CAPABILITY, not on row counts: app_migrator is neither superuser nor a member of
      // app_provisioner, so it cannot see the subledger and no result it produces means anything.
      // Counting rows could not have told us this — RLS zeroes the counts too, and "no legs" is also the
      // honest state of a torn-down test database.
      expect(result.coverage.blind).toBe(true);
      expect(result.ok).toBe(false);
      expect(formatReconciliation(result)).toMatch(/BLIND/);
    } finally {
      await blind.end();
    }

    // Sanity: the same data reconciles for a caller that can actually see it.
    expect((await checkGlReconciliation(executor)).ok).toBe(true);
  });

  it("catches a journal posted with the wrong amount", async () => {
    const movement = await app.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: CCY,
        amountMinor: 1000n,
        idempotencyKey: `topup:${randomUUID()}`,
      }),
    );

    /**
     * Tamper the queued payload BEFORE draining: the journal is immutable once posted, and the enqueue
     * trigger derives its payload from the real legs, so this is the only way to manufacture a books
     * -vs-subledger divergence. It stands in for the class of bug this gate exists to catch — a posting
     * path that mirrors the wrong number.
     */
    await owner`
      UPDATE gl_posting_requests
      SET legs = ${owner.json([
        {
          account_kind: "gateway_clearing",
          direction: "debit",
          amount_minor: "999",
        },
        { account_kind: "customer", direction: "credit", amount_minor: "999" },
      ])}
      WHERE ledger_txn_id = ${movement.txnId}`;

    await drainGlPostingRequests(provisioning.db);

    const result = await checkGlReconciliation(executor);
    expect(result.ok).toBe(false);
    // The movement was 1000 and the books recorded 999, so both control accounts are off by 1.
    // Keyed on kind AND currency: rows arrive ordered by both, so keying on kind alone would let a
    // residual NGN/USD row for the same kind overwrite the one under assertion.
    const byAccount = Object.fromEntries(
      result.discrepancies.map((d) => [
        `${d.kind}/${d.currency}`,
        d.differenceMinor,
      ]),
    );
    expect(byAccount[`gateway_clearing/${CCY}`]).toBe("1");
    expect(byAccount[`customer/${CCY}`]).toBe("-1");
    expect(formatReconciliation(result)).toMatch(
      /customer\/GHS: subledger .* vs books/,
    );

    /**
     * NOW CORRECT IT THE ONLY WAY THE BOOKS ALLOW. The bad journal cannot be edited or deleted — the
     * immutability triggers refuse it for every role, including the owner — so the correction is a
     * REVERSAL, which is exactly what an operator would have to do. Proving the recovery path is as
     * important as proving the detection.
     */
    const badJournals = (await owner`
      SELECT id FROM gl_journals
      WHERE idempotency_key = ${`ledger_txn:${movement.txnId}`}`) as Row[];
    const badJournalId = String(badJournals[0]?.id);

    await expect(
      owner`DELETE FROM gl_journals WHERE id = ${badJournalId}`,
    ).rejects.toThrow(/append-only/);

    const reversal = await reverseGlJournal(provisioning.db, {
      journalId: badJournalId,
      memo: "mis-mirrored amount from a tampered payload",
      requestedBy: "recon-integration-spec",
    });
    expect(reversal.alreadyReversed).toBe(false);
    // Reversing twice must not double-correct.
    expect(
      (
        await reverseGlJournal(provisioning.db, {
          journalId: badJournalId,
          memo: "retry",
          requestedBy: "recon-integration-spec",
        })
      ).alreadyReversed,
    ).toBe(true);

    // The books are now back to zero for that movement — but the SUBLEDGER still holds it, so the
    // ledgers still disagree. That is honest: an un-posted movement is a real divergence.
    const afterReversal = await checkGlReconciliation(executor);
    expect(afterReversal.ok).toBe(false);
    // BOTH legs must have flipped back, not just the one: a reversal that flipped only the credits
    // would leave gateway_clearing wrong and still pass a customer-only assertion.
    const afterByAccount = Object.fromEntries(
      afterReversal.discrepancies.map((d) => [
        `${d.kind}/${d.currency}`,
        d.differenceMinor,
      ]),
    );
    expect(afterByAccount[`customer/${CCY}`]).toBe("-1000");
    expect(afterByAccount[`gateway_clearing/${CCY}`]).toBe("1000");

    // Removing the movement itself is what finally squares them, and is only possible because this is
    // fabricated test data — in production the movement is real and the corrected journal would be
    // re-posted instead.
    await owner`DELETE FROM ledger_entries WHERE txn_id = ${movement.txnId}`;
    await owner`DELETE FROM ledger_transactions WHERE id = ${movement.txnId}`;
    expect((await checkGlReconciliation(executor)).ok).toBe(true);
  });
});
