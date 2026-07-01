// ============================================================================================
// SECURITY-LAYER-APPLIED + SCHEMA-DRIFT CHECK — QA CI gate (adams).
// Closes the #1 P0: "RLS/roles authored but not wired" (empty drizzle journal). Root cause was
// drizzle-kit `generate` never working under NodeNext `.js` resolution (fixed by pascal's bump).
//
// Framework-agnostic (SqlExecutor) so the Vitest integration test AND the standing CI job import
// the SAME assertions — mirrors ledger-invariant.check.ts.
//
// WHAT IT GUARDS (runs against a FRESHLY-MIGRATED DB — the canonical `pnpm db:generate && db:migrate`
// path CI will use, NOT hand-applied SQL):
//   1. app_runtime exists and does NOT have BYPASSRLS (B4).
//   2. every tenant table has FORCE ROW LEVEL SECURITY (B4) and at least one RLS policy (B3).
//   3. append-only: app_runtime lacks UPDATE/DELETE on ledger_entries (ledger immutability).
// The COMPLEMENTARY "journal reproduces the applied schema" drift check is a CI *process* step
// (run `drizzle-kit generate` after migrate → assert it emits an EMPTY diff); spec in §3 of the
// strategy doc. This module is the DB-state half.
// ============================================================================================

export interface SqlExecutor {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Every tenant-scoped table that MUST be under RLS. Extend as domains are added (sms, otp, …). */
export const TENANT_TABLES = [
  "accounts",
  "memberships",
  "users",
  "data_subjects",
  "dek_keys",
  "pii_vault",
  "erasure_log",
  "ledger_accounts",
  "ledger_transactions",
  "ledger_entries",
  "api_keys",
] as const;

// The prod-faithful role model (653b45d): app_migrator OWNS the schema (non-super → FORCE RLS bites it
// like prod); app_owner is the test-only superuser (the ONLY role allowed to hold BYPASSRLS locally).
const MIGRATION_OWNER = "app_migrator";
const SUPER_ROLE = "app_owner";
// (B-policy) — there is NO sanctioned SECURITY DEFINER at all (possession-scoped policy instead).
// A future sanctioned one is a deliberate, reviewed addition here; empty = zero RLS-bypass functions.
const ALLOWED_SECURITY_DEFINERS: readonly string[] = [];

export interface SecurityLayerResult {
  ok: boolean;
  violations: string[];
}

const RUNTIME_ROLE = "app_runtime";

export async function checkSecurityLayerApplied(
  db: SqlExecutor,
  tenantTables: readonly string[] = TENANT_TABLES,
): Promise<SecurityLayerResult> {
  const violations: string[] = [];
  const list = tenantTables.map((t) => `'${t}'`).join(", ");

  // 1. runtime role exists + no BYPASSRLS (B4).
  const role = await db.query(
    `SELECT rolbypassrls FROM pg_roles WHERE rolname = '${RUNTIME_ROLE}'`,
  );
  if (role.rows.length === 0) {
    violations.push(
      `role '${RUNTIME_ROLE}' does not exist — runtime must connect as a non-owner role`,
    );
  } else if (role.rows[0]?.rolbypassrls === true) {
    violations.push(
      `role '${RUNTIME_ROLE}' has BYPASSRLS — RLS is effectively OFF (B4)`,
    );
  }

  // 2a. FORCE RLS on every tenant table (B4). relforcerowsecurity must be true; also flags missing tables.
  const force = await db.query(`
    SELECT c.relname, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (${list})
  `);
  const seen = new Map(
    force.rows.map((r) => [String(r.relname), r.relforcerowsecurity === true]),
  );
  for (const t of tenantTables) {
    if (!seen.has(t))
      violations.push(
        `tenant table '${t}' not found in DB — migration did not apply?`,
      );
    else if (!seen.get(t))
      violations.push(`table '${t}' is missing FORCE ROW LEVEL SECURITY (B4)`);
  }

  // 2b. at least one RLS policy per tenant table (B3). Policy names vary (tenant_isolation /
  // tenant_visibility), so assert presence, not a specific name.
  const pol = await db.query(
    `SELECT tablename, count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename IN (${list}) GROUP BY tablename`,
  );
  const polCount = new Map(
    pol.rows.map((r) => [String(r.tablename), Number(r.n)]),
  );
  for (const t of tenantTables) {
    if ((polCount.get(t) ?? 0) === 0)
      violations.push(
        `table '${t}' has no RLS policy (B3) — reads/writes would fail-open or fail-closed with no scoping`,
      );
  }

  // 3. append-only: app_runtime must NOT hold UPDATE/DELETE on ledger_entries.
  const priv = await db.query(`
    SELECT privilege_type FROM information_schema.role_table_grants
    WHERE grantee='${RUNTIME_ROLE}' AND table_name='ledger_entries' AND privilege_type IN ('UPDATE','DELETE')
  `);
  for (const r of priv.rows) {
    violations.push(
      `'${RUNTIME_ROLE}' holds ${r.privilege_type} on ledger_entries — append-only ledger is not enforced`,
    );
  }

  // 4. (B4/L2) ZERO SECURITY DEFINER functions in public — the (B-policy) invariant: no privileged
  // RLS-bypass path. Any prosecdef function not on the (empty) allowlist is a rogue bypass.
  const defs = await db.query(
    "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.prosecdef = true",
  );
  for (const r of defs.rows) {
    const name = String(r.proname);
    if (!ALLOWED_SECURITY_DEFINERS.includes(name))
      violations.push(
        `SECURITY DEFINER function '${name}' exists — a non-allowlisted RLS-bypass path (B-policy requires zero)`,
      );
  }

  // 5. No role OTHER than the test-only superuser may hold BYPASSRLS (app_runtime + app_migrator must not).
  const bypass = await db.query(
    "SELECT rolname FROM pg_roles WHERE rolbypassrls = true",
  );
  for (const r of bypass.rows) {
    const name = String(r.rolname);
    if (name !== SUPER_ROLE)
      violations.push(
        `role '${name}' has BYPASSRLS but is not the test-only superuser '${SUPER_ROLE}' — unexpected RLS-bypass`,
      );
  }

  // 6. GATE #5 (prod fidelity) — the migration owner must be NON-super and OWN the tenant tables, so
  // FORCE RLS applies to the owner exactly as prod (a superuser owner would mask owner-vs-FORCE breaks).
  const owner = await db.query(
    `SELECT rolsuper FROM pg_roles WHERE rolname = '${MIGRATION_OWNER}'`,
  );
  if (owner.rows.length === 0)
    violations.push(`migration owner '${MIGRATION_OWNER}' does not exist`);
  else if (owner.rows[0]?.rolsuper === true)
    violations.push(
      `migration owner '${MIGRATION_OWNER}' is a SUPERUSER — it bypasses RLS and masks prod-only FORCE-RLS-vs-owner breaks`,
    );
  const misowned = await db.query(`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles o ON o.oid = c.relowner
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN (${list}) AND o.rolname <> '${MIGRATION_OWNER}'
  `);
  for (const r of misowned.rows) {
    violations.push(
      `tenant table '${String(r.relname)}' is not owned by '${MIGRATION_OWNER}' — FORCE RLS may not apply to the owner as in prod`,
    );
  }

  return { ok: violations.length === 0, violations };
}

export function formatSecurityViolations(r: SecurityLayerResult): string {
  return r.ok
    ? "security layer applied ✓ (non-owner role, FORCE RLS + policy on every tenant table, ledger append-only)"
    : `security layer NOT correctly applied:\n${r.violations.map((v) => `  ✗ ${v}`).join("\n")}`;
}
