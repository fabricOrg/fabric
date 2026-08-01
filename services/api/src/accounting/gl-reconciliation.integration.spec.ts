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
import { correctGlPosting } from "./gl-correction.js";
import { drainGlPostingRequests } from "./gl-posting.worker.js";

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

/**
 * The stable error code out of an F8.3 envelope. `invalidRequest`/`notFound` throw a Nest
 * HttpException whose body carries the code, so asserting on `.code` of the exception itself would
 * silently match nothing.
 */
async function errorCodeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "(no error thrown)";
  } catch (error) {
    const body = (error as { getResponse?: () => unknown }).getResponse?.() as
      | { error?: { code?: string } }
      | undefined;
    return body?.error?.code ?? "(no code in envelope)";
  }
}

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
     * NOW CORRECT IT. The bad journal cannot be edited or deleted — the immutability triggers refuse it
     * for every role including the owner — so a correction is two postings: reverse the wrong one, and
     * re-post the movement from the LIVE subledger legs under a correction key. Proving the recovery
     * path matters as much as proving the detection, because a gate with no remedy just teaches people
     * to bypass gates.
     */
    const badJournals = (await owner`
      SELECT id FROM gl_journals
      WHERE idempotency_key = ${`ledger_txn:${movement.txnId}`}`) as Row[];
    const badJournalId = String(badJournals[0]?.id);

    await expect(
      owner`DELETE FROM gl_journals WHERE id = ${badJournalId}`,
    ).rejects.toThrow(/append-only/);

    const corrected = await correctGlPosting(provisioning.db, {
      journalId: badJournalId,
      reason: "payload mirrored the wrong amount",
      requestedBy: "recon-integration-spec",
    });
    expect(corrected.correctionSequence).toBe(2);

    // The whole point: the ledgers agree again, with the wrong entry still visible in the books.
    const afterCorrection = await checkGlReconciliation(executor);
    expect(formatReconciliation(afterCorrection)).toContain("reconciles");
    expect(afterCorrection.ok).toBe(true);

    // Three journals now exist for this one movement, and the legs are counted ONCE — the semi-join
    // scope, not a join. A fan-out here would double the subledger side and reopen the discrepancy.
    const mirrors = (await owner`
      SELECT count(*)::int AS n FROM gl_journals
      WHERE source_kind = 'ledger_txn' AND source_ref = ${movement.txnId}`) as Row[];
    // original + correction; the reversal carries source_kind 'reversal', so it is not a third mirror.
    expect(Number(mirrors[0]?.n)).toBe(2);
    expect(afterCorrection.coverage.subledgerLegs).toBeGreaterThan(0);

    // The correction carries the right amount and the reversal cancelled the wrong one.
    const net = (await owner`
      SELECT a.code, SUM(CASE l.direction WHEN 'credit' THEN l.amount_minor
                                          ELSE -l.amount_minor END)::text AS net
      FROM gl_journal_lines l
      JOIN gl_journals j ON j.id = l.journal_id
      JOIN gl_accounts a ON a.id = l.account_id
      WHERE j.source_ref = ${movement.txnId} OR j.reverses_journal_id = ${badJournalId}
      GROUP BY a.code ORDER BY a.code`) as Row[];
    expect(net.map((r) => [String(r.code), String(r.net)])).toEqual([
      ["1100", "-1000"],
      ["2100", "1000"],
    ]);
  });

  it("refuses to correct a journal that is not a mirror", async () => {
    const movement = await app.withTenant(TENANT, (tx) =>
      credit(tx, {
        currency: CCY,
        amountMinor: 600n,
        idempotencyKey: `topup:${randomUUID()}`,
      }),
    );
    await drainGlPostingRequests(provisioning.db);
    const rows = (await owner`
      SELECT id FROM gl_journals
      WHERE idempotency_key = ${`ledger_txn:${movement.txnId}`}`) as Row[];
    const journalId = String(rows[0]?.id);

    const first = await correctGlPosting(provisioning.db, {
      journalId,
      reason: "first correction",
      requestedBy: "recon-integration-spec",
    });

    // A reversal has no subledger movement to re-derive from, so it is corrected by its own reversal,
    // not by this path.
    expect(
      await errorCodeOf(() =>
        correctGlPosting(provisioning.db, {
          journalId: first.reversalJournalId,
          reason: "nonsense",
          requestedBy: "recon-integration-spec",
        }),
      ),
    ).toBe("gl_journal_not_a_mirror");

    /**
     * And correcting the ORIGINAL again is refused. This is the assertion that caught a real double-post:
     * without the guard, the already-reversed original got a SECOND correction and the books recorded the
     * movement twice over. Correct the journal that superseded it instead.
     */
    expect(
      await errorCodeOf(() =>
        correctGlPosting(provisioning.db, {
          journalId,
          reason: "again",
          requestedBy: "recon-integration-spec",
        }),
      ),
    ).toBe("gl_journal_already_corrected");

    expect((await checkGlReconciliation(executor)).ok).toBe(true);
  });
});
