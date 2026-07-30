// ============================================================================================
// DB ASSERT RUNNER — standing money/security gate, framework-agnostic (fifi, ratified define-now).
//
// WHY: the RLS/roles + write-time + ledger-invariant checks (test/*.check.ts) previously ran ONLY
// via Vitest (`test:integration`). A regression could merge to `dev` with nobody running them. This
// CLI runs the SAME assertions (one definition of "correct", no drift) against a migrated DB and
// EXITS NON-ZERO on any violation — so it can gate a merge (locally now via `pnpm db:assert`; via a
// CI job when a git remote lands — that pipeline is the deliberately-deferred "provision-later" half).
//
// It asserts ONLY (single responsibility) — it does not migrate. Point DATABASE_URL_OWNER at a
// freshly-migrated DB first (the canonical path: `pnpm db:up && pnpm db:migrate`), exactly like
// security-layer.integration.spec.ts. Most gates run as the OWNER url because they read pg_roles /
// pg_class / pg_policies / role_table_grants / pg_trigger. The `recon` gate is the exception — it needs
// a cross-tenant read of the subledger, so it uses DATABASE_URL_PROVISIONER (see below).
//
// USAGE:  tsx scripts/assert.ts [security|ledger|gl|recon]    (no arg = run all)
// EXIT:   0 = all pass · 1 = a violation (or runtime error) · 2 = misconfigured (missing a DATABASE_URL)
// ============================================================================================

import postgres from "postgres";
import { checkGlInvariants, formatGlViolations } from "../src/gl-invariant.js";
import {
  checkGlReconciliation,
  formatReconciliation,
} from "../src/gl-reconciliation.js";
import {
  checkLedgerInvariants,
  formatViolations,
} from "../src/ledger-invariant.js";
import {
  checkSecurityLayerApplied,
  formatSecurityViolations,
} from "../test/security-layer.check.js";

const OWNER_URL = process.env.DATABASE_URL_OWNER;
if (!OWNER_URL) {
  console.error(
    "db:assert requires DATABASE_URL_OWNER (a freshly-migrated DB — run `pnpm db:up && pnpm db:migrate`)",
  );
  process.exit(2);
}

// Which gate(s) to run — lets `db:assert:security` / `db:assert:ledger` target one without a second
// runner. Unknown arg fails loud rather than silently running nothing.
const which = process.argv[2] ?? "all";
if (!["all", "security", "ledger", "gl", "recon"].includes(which)) {
  console.error(
    `unknown gate '${which}' — expected: security | ledger | gl | recon | (none for all)`,
  );
  process.exit(2);
}

/**
 * The reconciliation is a CROSS-TENANT read of the subledger, so it runs on the provisioning
 * connection — not the owner one the other gates use.
 *
 * `ledger_entries`, `ledger_accounts` and `accounts` are FORCE RLS, and the permissive policies that
 * see across tenants name `app_provisioner` (0013, 0027). The owner URL is `app_migrator` in CI and in
 * the cloud — non-superuser, no membership in that role — so it reads ZERO rows there. The check's own
 * blindness guard catches that and refuses to report success, which is exactly how this wiring mistake
 * surfaced; the fix is to hand it the connection that was designed for the job, the same one the hourly
 * maintenance pass already uses.
 */
const RECON_URL =
  process.env.DATABASE_URL_PROVISIONER ?? process.env.DATABASE_URL_SUPER;
if ((which === "all" || which === "recon") && !RECON_URL) {
  console.error(
    "the recon gate requires DATABASE_URL_PROVISIONER (or _SUPER): reconciling needs cross-tenant read of the subledger, which the owner role does not have",
  );
  process.exit(2);
}

const sql = postgres(OWNER_URL, { max: 2 });
// The one-line adapter to the checks' SqlExecutor shape — identical to the integration specs, so the
// CLI and Vitest exercise byte-for-byte the same assertions.
const db = {
  query: async (q: string) => ({
    rows: (await sql.unsafe(q)) as Array<Record<string, unknown>>,
  }),
};

const reconSql = RECON_URL ? postgres(RECON_URL, { max: 1 }) : null;
const reconDb = reconSql
  ? {
      query: async (q: string) => ({
        rows: (await reconSql.unsafe(q)) as Array<Record<string, unknown>>,
      }),
    }
  : db;

async function main(): Promise<void> {
  let failed = false;

  if (which === "all" || which === "security") {
    const r = await checkSecurityLayerApplied(db);
    console.log(formatSecurityViolations(r));
    if (!r.ok) failed = true;
  }

  if (which === "all" || which === "ledger") {
    const r = await checkLedgerInvariants(db);
    console.log(formatViolations(r));
    if (!r.ok) failed = true;
  }

  // The corporate general ledger (ADR-0013). Separate from `ledger` because they are two ledgers with
  // two definitions of correct, and a deploy needs to know WHICH one broke.
  if (which === "all" || which === "gl") {
    const r = await checkGlInvariants(db);
    console.log(formatGlViolations(r));
    if (!r.ok) failed = true;
  }

  // The Phase 1 exit gate: the two ledgers must agree, not merely each be internally consistent.
  if (which === "all" || which === "recon") {
    const r = await checkGlReconciliation(reconDb);
    console.log(formatReconciliation(r));
    if (!r.ok) failed = true;
  }

  if (failed) {
    console.error(
      "\n✗ DB assertions FAILED — the write-time/security invariants do not hold",
    );
    process.exit(1);
  }
  console.log("\n✓ all DB assertions passed");
}

main()
  .catch((err) => {
    console.error("\n✗ db:assert crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
    if (reconSql) await reconSql.end();
  });
