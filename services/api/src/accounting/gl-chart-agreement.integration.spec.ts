import {
  currency,
  glAccountCodeSchema,
  ledgerAccountKindSchema,
} from "@app/contracts";
import { ENABLED_CURRENCIES } from "@app/db";
import { SUBLEDGER_KIND_TO_GL_ACCOUNT } from "@app/domain";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Pins the TypeScript view of the chart of accounts to the DATABASE's (ADR-0013, migration 0112).
 *
 * The chart of accounts is seeded reference data rather than an enum, precisely so Finance can add
 * accounts without an `ADD VALUE` migration. The price of that choice is that the shared types could
 * drift from the seeded rows — so this spec is where the choice is paid for. It lives in the API
 * because that is the only package that already depends on `@app/contracts`, `@app/domain`, and a real
 * database; asserting it inside `@app/db` would mean inverting the dependency graph for a test.
 */

const SUPER_URL = process.env.DATABASE_URL_SUPER;
if (!SUPER_URL) {
  throw new Error("GL chart agreement gate requires DATABASE_URL_SUPER");
}
const owner = postgres(SUPER_URL, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await owner.end();
});

describe("general-ledger chart of accounts agrees with the shared types", () => {
  it("declares exactly the subledger account kinds the database has", async () => {
    // A kind in the DB but not in the union would post through an unmapped path; a kind in the union
    // but not the DB would map money that can never move.
    const rows = await owner<{ kind: string }[]>`
      SELECT unnest(enum_range(NULL::ledger_account_kind))::text AS kind`;
    expect([...ledgerAccountKindSchema.options].sort()).toEqual(
      rows.map((r) => r.kind).sort(),
    );
  });

  it("declares exactly the account codes the migration seeded", async () => {
    const rows = await owner<{ code: string }[]>`
      SELECT code FROM gl_accounts ORDER BY code`;
    expect([...glAccountCodeSchema.options].sort()).toEqual(
      rows.map((r) => r.code).sort(),
    );
  });

  it("reconciles over exactly the currencies the contract enables", async () => {
    // `@app/db` cannot import the contract (it does not depend on it), so the reconciliation keeps its
    // own copy of the enabled currency set. A currency in one list and not the other would silently drop
    // every movement in it out of the reconciliation — a hole that reports as green.
    expect([...ENABLED_CURRENCIES].sort()).toEqual(
      [...currency.options].sort(),
    );
  });

  it("maps every kind to the same control account the database nominates", async () => {
    // The mapping is the bridge between the two ledgers. If TypeScript and the database disagree
    // about it, postings and reconciliation would each be internally consistent and jointly wrong.
    const rows = await owner<{ kind: string; code: string }[]>`
      SELECT control_for_kind AS kind, code FROM gl_accounts
      WHERE control_for_kind IS NOT NULL`;
    const fromDb = Object.fromEntries(rows.map((r) => [r.kind, r.code]));
    expect(fromDb).toEqual(SUBLEDGER_KIND_TO_GL_ACCOUNT);
  });
});
