import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkGlInvariants,
  formatGlViolations,
  glAccountBalances,
} from "../src/gl-invariant.js";

/**
 * Real-Postgres gate for the corporate general ledger (ADR-0013, migrations 0111 + 0112).
 *
 * THIS SPEC CANNOT CLEAN UP AFTER ITSELF, BY DESIGN. Posted history is immutable for every role
 * including the table owner (trigger, not privilege — see 0112), so there is no teardown to write: the
 * rows it posts stay forever, exactly as production rows would. That is the invariant under test, and
 * exempting the test from it would be testing something else.
 *
 * It therefore takes a RUN-SCOPED CURRENCY rather than sharing one: the GL is non-tenant-scoped shared
 * state, so a fixed currency would accumulate across runs and make any absolute balance assertion
 * drift. `X__` is in the ISO 4217 range reserved for non-currencies, and the contract's `currency` enum
 * is GHS/NGN/USD only, so no production path can ever land in this slice of the books.
 */

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "general-ledger gate requires DATABASE_URL_SUPER + DATABASE_URL_APP",
  );
}

const owner = postgres(SUPER_URL, { max: 1, onnotice: () => {} });
const runtime = postgres(APP_URL, { max: 1, onnotice: () => {} });

/** Adapter from postgres.js to the invariant module's executor shape. */
const executor = {
  query: async (sql: string) => ({
    rows: (await owner.unsafe(sql)) as unknown as Record<string, unknown>[],
  }),
};

const RUN = randomUUID();
const key = (suffix: string) => `test:${RUN}:${suffix}`;
/** e.g. 'X3F' — see the header. Two hex chars from the run id keep concurrent runs apart. */
const CCY = `X${RUN.slice(0, 2).toUpperCase()}`;

const GL_TABLES = ["gl_accounts", "gl_journals", "gl_journal_lines"] as const;
const ALL_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

async function accountId(code: string): Promise<string> {
  const rows = await owner<{ id: string }[]>`
    SELECT id FROM gl_accounts WHERE code = ${code}`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`chart of accounts is missing code ${code}`);
  return id;
}

interface Leg {
  code: string;
  direction: "debit" | "credit";
  amount: string;
}

/**
 * Post a journal in the run currency. `declaredLines` defaults to the real count so callers can pass a
 * wrong one deliberately to prove the completeness check bites.
 */
async function post(
  suffix: string,
  legs: readonly Leg[],
  declaredLines = legs.length,
): Promise<string> {
  const resolved = await Promise.all(
    legs.map(async (l) => ({ ...l, accountId: await accountId(l.code) })),
  );
  return await owner.begin(async (tx) => {
    const [journal] = await tx<{ id: string }[]>`
      INSERT INTO gl_journals
        (idempotency_key, source_kind, source_ref, currency, event_time, accounting_date, line_count)
      VALUES (${key(suffix)}, 'ledger_txn', ${suffix}, ${CCY}, now(), current_date,
              ${declaredLines})
      RETURNING id`;
    const journalId = journal?.id;
    if (!journalId) throw new Error("journal insert returned no id");
    for (const l of resolved) {
      await tx`
        INSERT INTO gl_journal_lines (journal_id, account_id, direction, amount_minor)
        VALUES (${journalId}, ${l.accountId}, ${l.direction}, ${l.amount}::bigint)`;
    }
    return journalId;
  });
}

const TOP_UP: readonly Leg[] = [
  { code: "1100", direction: "debit", amount: "5000" },
  { code: "2100", direction: "credit", amount: "5000" },
];

afterAll(async () => {
  await runtime.end();
  await owner.end();
});

describe("corporate general ledger invariants", () => {
  describe("chart of accounts", () => {
    it("seeds exactly the accounts phase 1 posts to, all as control accounts", async () => {
      const rows = await owner<
        { code: string; control_for_kind: string | null }[]
      >`
        SELECT code, control_for_kind FROM gl_accounts ORDER BY code`;
      expect(rows.map((r) => r.code)).toEqual([
        "1100",
        "2100",
        "2110",
        "2200",
        "4100",
        "5900",
      ]);
      expect(rows.every((r) => r.control_for_kind !== null)).toBe(true);
    });

    it("gives every subledger account kind a control account", async () => {
      // An unmapped kind is money moving in the subledger with no counterpart in the company's
      // books — a permanent hole in the reconciliation.
      const unmapped = await owner<{ kind: string }[]>`
        SELECT k::text AS kind
        FROM unnest(enum_range(NULL::ledger_account_kind)) AS k
        WHERE k NOT IN (
          SELECT control_for_kind FROM gl_accounts WHERE control_for_kind IS NOT NULL)`;
      expect(unmapped.map((r) => r.kind)).toEqual([]);
    });

    it("refuses a second control account for the same kind", async () => {
      await expect(
        owner`
          INSERT INTO gl_accounts (code, name, type, normal_balance, control_for_kind)
          VALUES (${key("dup")}, 'Duplicate control', 'liability', 'credit', 'customer')`,
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  describe("write-time enforcement", () => {
    it("posts a balanced journal whose lines are exactly the movement", async () => {
      const journalId = await post("balanced", TOP_UP);
      const lines = await owner<
        { code: string; direction: string; amount_minor: string }[]
      >`
        SELECT a.code, l.direction, l.amount_minor::text
        FROM gl_journal_lines l JOIN gl_accounts a ON a.id = l.account_id
        WHERE l.journal_id = ${journalId} ORDER BY a.code`;
      expect(lines).toEqual([
        { code: "1100", direction: "debit", amount_minor: "5000" },
        { code: "2100", direction: "credit", amount_minor: "5000" },
      ]);
    });

    it("computes a balance as the signed sum of the lines, with the documented sign", async () => {
      /**
       * Asserted with EXACT MAGNITUDES against a fresh currency this test owns outright, so it actually
       * pins the sign convention. Comparing the function against a hand-copied transcription of its own
       * SQL would prove nothing: inverting the convention in gl-invariant.ts would invert both sides
       * and still pass.
       *
       * A per-test currency, not the per-run one: the GL is append-only and shared, and three
       * characters carry too little entropy for a run-scoped code to stay private across accumulated
       * runs, so absolute totals are only safe on a currency nothing else has touched.
       */
      const ccy = `Y${RUN.slice(2, 4).toUpperCase()}`;
      const cash = await accountId("1100");
      const liability = await accountId("2100");
      await owner.begin(async (tx) => {
        const [j] = await tx<{ id: string }[]>`
          INSERT INTO gl_journals
            (idempotency_key, source_kind, source_ref, currency, event_time,
             accounting_date, line_count)
          VALUES (${key("sign")}, 'ledger_txn', 'sign', ${ccy}, now(), current_date, 2)
          RETURNING id`;
        const signJournal = j?.id;
        if (!signJournal) throw new Error("journal insert returned no id");
        await tx`
          INSERT INTO gl_journal_lines (journal_id, account_id, direction, amount_minor)
          VALUES (${signJournal}, ${cash}, 'debit', 700),
                 (${signJournal}, ${liability}, 'credit', 700)`;
      });

      const reported = (await glAccountBalances(executor)).filter(
        (b) => b.currency === ccy,
      );
      // Σ credits − Σ debits: a debit-normal asset account computes NEGATIVE (ADR-0013 #7).
      expect(reported).toEqual([
        { code: "1100", currency: ccy, balanceMinor: "-700" },
        { code: "2100", currency: ccy, balanceMinor: "700" },
      ]);
    });

    it("rejects an unbalanced journal at commit", async () => {
      await expect(
        post("unbalanced", [
          { code: "1100", direction: "debit", amount: "5000" },
          { code: "2100", direction: "credit", amount: "4999" },
        ]),
      ).rejects.toThrow(/unbalanced/);
    });

    it("rejects a journal that declares more lines than it posts", async () => {
      await expect(post("short", TOP_UP, 4)).rejects.toThrow(/declares 4/);
    });

    it("rejects a journal that posted no lines at all", async () => {
      // An empty journal sums to zero, so balance alone would let it through while it sat holding an
      // idempotency key waiting to be filled later.
      await expect(post("empty", [], 2)).rejects.toThrow(/declares 2/);
    });

    it("rejects a single-line journal at the declared minimum", async () => {
      await expect(
        post(
          "one-line",
          [{ code: "1100", direction: "debit", amount: "1" }],
          1,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("rejects a non-positive line amount", async () => {
      await expect(
        post("zero-amount", [
          { code: "1100", direction: "debit", amount: "0" },
          { code: "2100", direction: "credit", amount: "0" },
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("rejects a replayed idempotency key so a redelivery posts once", async () => {
      const suffix = "replay";
      await post(suffix, TOP_UP);
      await expect(post(suffix, TOP_UP)).rejects.toMatchObject({
        code: "23505",
      });
    });

    it("refuses a balanced pair APPENDED to an already-committed journal", async () => {
      // The hole that balance-alone leaves open: a second balanced pair also nets to zero, so without
      // the declared line count this would commit — writing fabricated revenue into a closed period
      // while every invariant still reported healthy.
      const journalId = await post("append-target", TOP_UP);
      const reserved = await accountId("2110");
      const revenue = await accountId("4100");
      await expect(
        owner`
          INSERT INTO gl_journal_lines (journal_id, account_id, direction, amount_minor)
          VALUES (${journalId}, ${reserved}, 'debit', 999999),
                 (${journalId}, ${revenue}, 'credit', 999999)`,
      ).rejects.toThrow(/cannot be appended to/);
    });
  });

  describe("immutability (trigger, not privilege)", () => {
    /**
     * Asserted over the OWNER connection — a superuser locally, and the table owner. Triggers are not
     * bypassed by ownership or superuser, which is the whole point: `prepareRoles()` re-grants full DML
     * to app_provisioner on every deploy, so a privilege-based guarantee would silently lapse. In
     * production the owner (app_migrator) is non-superuser, so this is a hard guarantee.
     */
    it("refuses UPDATE and DELETE on a posted journal and its lines, even as owner", async () => {
      const journalId = await post("immutable", TOP_UP);

      await expect(
        owner`UPDATE gl_journal_lines SET amount_minor = 1 WHERE journal_id = ${journalId}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        owner`DELETE FROM gl_journal_lines WHERE journal_id = ${journalId}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        owner`UPDATE gl_journals SET memo = 'rewritten' WHERE id = ${journalId}`,
      ).rejects.toThrow(/append-only/);
      await expect(
        owner`DELETE FROM gl_journals WHERE id = ${journalId}`,
      ).rejects.toThrow(/append-only/);
    });

    it("refuses TRUNCATE, which row triggers would not see", async () => {
      await expect(owner`TRUNCATE gl_journal_lines`).rejects.toThrow(
        /append-only/,
      );
      // gl_journals is referenced by a foreign key, so Postgres may refuse the TRUNCATE before the
      // trigger runs. Either refusal is acceptable; what matters is that it cannot succeed.
      await expect(owner`TRUNCATE gl_journals`).rejects.toThrow();
    });
  });

  describe("reversals", () => {
    it("rejects a reversal that names no journal to reverse", async () => {
      await expect(
        owner`
          INSERT INTO gl_journals
            (idempotency_key, source_kind, source_ref, currency, event_time,
             accounting_date, line_count)
          VALUES (${key("bad-rev")}, 'reversal', 'x', ${CCY}, now(), current_date, 2)`,
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("nets a journal and its reversal to zero and refuses a second reversal", async () => {
      const original = await post("to-reverse", [
        { code: "2110", direction: "debit", amount: "300" },
        { code: "4100", direction: "credit", amount: "300" },
      ]);
      const reserved = await accountId("2110");
      const revenue = await accountId("4100");

      const reverse = (suffix: string) =>
        owner.begin(async (tx) => {
          const [j] = await tx<{ id: string }[]>`
            INSERT INTO gl_journals
              (idempotency_key, source_kind, source_ref, currency, event_time,
               accounting_date, line_count, reverses_journal_id)
            VALUES (${key(suffix)}, 'reversal', ${original}, ${CCY}, now(), current_date,
                    2, ${original})
            RETURNING id`;
          const reversalId = j?.id;
          if (!reversalId) throw new Error("reversal insert returned no id");
          await tx`
            INSERT INTO gl_journal_lines (journal_id, account_id, direction, amount_minor)
            VALUES (${reversalId}, ${reserved}, 'credit', 300),
                   (${reversalId}, ${revenue}, 'debit', 300)`;
        });

      await reverse("rev-1");
      const [net] = await owner<{ sum: string }[]>`
        SELECT COALESCE(SUM(CASE l.direction WHEN 'credit' THEN l.amount_minor
                                             ELSE -l.amount_minor END), 0)::text AS sum
        FROM gl_journal_lines l JOIN gl_journals j ON j.id = l.journal_id
        WHERE j.id = ${original} OR j.reverses_journal_id = ${original}`;
      expect(net?.sum).toBe("0");

      // UNIQUE(reverses_journal_id): a retried correction cannot overstate the books the other way.
      await expect(reverse("rev-2")).rejects.toMatchObject({ code: "23505" });
    });

    it("refuses a journal that reverses itself", async () => {
      const id = randomUUID();
      await expect(
        owner`
          INSERT INTO gl_journals
            (id, idempotency_key, source_kind, source_ref, currency, event_time,
             accounting_date, line_count, reverses_journal_id)
          VALUES (${id}, ${key("self-rev")}, 'reversal', ${id}, ${CCY}, now(),
                  current_date, 2, ${id})`,
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("the privilege boundary (ADR-0013 #2)", () => {
    /**
     * Asserted with `has_table_privilege` on the NAMED role rather than by attempting a write over a
     * role's connection. Locally `DATABASE_URL_PROVISIONER` connects as the superuser owner, so a
     * connection-based denial test would silently succeed and report a correct migration as broken.
     * This reads the actual grant regardless of who is connected, and counts privileges inherited
     * through role membership.
     */
    it("grants app_runtime nothing at all on the company books", async () => {
      const rows = await owner<
        { table_name: string; priv: string; allowed: boolean }[]
      >`
        SELECT t.table_name, p.priv,
               has_table_privilege('app_runtime', t.table_name, p.priv) AS allowed
        FROM unnest(${owner.array([...GL_TABLES])}::text[]) AS t(table_name),
             unnest(${owner.array([...ALL_PRIVILEGES])}::text[]) AS p(priv)`;
      expect(rows.filter((r) => r.allowed)).toEqual([]);
    });

    it("lets the control plane post but never rewrite posted history", async () => {
      const rows = await owner<{ table_name: string; priv: string }[]>`
        SELECT t.table_name, p.priv
        FROM unnest(${owner.array(["gl_journals", "gl_journal_lines", "gl_accounts"])}::text[])
               AS t(table_name),
             unnest(${owner.array(["UPDATE", "DELETE", "TRUNCATE"])}::text[]) AS p(priv)
        WHERE has_table_privilege('app_provisioner', t.table_name, p.priv)`;
      expect(rows).toEqual([]);

      const [allowed] = await owner<
        { journals: boolean; lines: boolean; accounts_insert: boolean }[]
      >`
        SELECT has_table_privilege('app_provisioner','gl_journals','INSERT')      AS journals,
               has_table_privilege('app_provisioner','gl_journal_lines','INSERT') AS lines,
               has_table_privilege('app_provisioner','gl_accounts','INSERT')      AS accounts_insert`;
      // The chart of accounts is maintained by migration, not by the application.
      expect(allowed).toEqual({
        journals: true,
        lines: true,
        accounts_insert: false,
      });
    });

    it("denies a live app_runtime connection every GL table", async () => {
      // DATABASE_URL_APP genuinely connects as app_runtime, so this end-to-end check is meaningful.
      for (const table of GL_TABLES) {
        await expect(
          runtime.unsafe(`SELECT 1 FROM ${table} LIMIT 1`),
        ).rejects.toMatchObject({ code: "42501" });
      }
    });
  });

  it("satisfies the standing GL invariants", async () => {
    const result = await checkGlInvariants(executor);
    expect(formatGlViolations(result)).toContain("OK");
    expect(result.ok).toBe(true);
  });
});
