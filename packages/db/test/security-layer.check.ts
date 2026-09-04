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
  // The GL posting airlock (0114) — the one tenant-scoped table in the general-ledger domain, and the
  // only one the tenant-facing role may write. It carries tenant_id, so it needs FORCE RLS and a policy
  // like any other tenant table.
  "gl_posting_requests",
  "token_lots",
  "token_counters",
  "token_holds",
  "token_recognition_allocations",
  "api_keys",
  "messages",
  "whatsapp_messages",
  "whatsapp_inbound_messages",
  "whatsapp_service_windows",
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

  // 3b. Published definition versions are durable release evidence. A live-derived Neon audit caught
  // UPDATE + DELETE grants despite 0076's intended REVOKE, so assert effective privileges rather
  // than trusting a journal entry that runs only once.
  for (const roleName of [RUNTIME_ROLE, "app_provisioner"]) {
    const rewrite = await db.query(`
      SELECT p AS priv
      FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) AS p
      WHERE has_table_privilege('${roleName}', 'message_definition_versions', p)
    `);
    for (const row of rewrite.rows) {
      violations.push(
        `'${roleName}' holds ${String(row.priv)} on message_definition_versions — published content must be immutable`,
      );
    }
    // Assert the POSITIVE half too. A revoke that went too far (an `ALTER DEFAULT PRIVILEGES` sweep,
    // a REVOKE ALL) would leave this check green while definition publishing 500s in production —
    // the same shape of blind spot as a document that byte-compares against its own broken self.
    const required = await db.query(`
      SELECT p AS priv
      FROM unnest(ARRAY['SELECT','INSERT']) AS p
      WHERE NOT has_table_privilege('${roleName}', 'message_definition_versions', p)
    `);
    for (const row of required.rows) {
      violations.push(
        `'${roleName}' LACKS ${String(row.priv)} on message_definition_versions — publishing and reading released content would fail`,
      );
    }
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

  // 5. No application role other than the test-only superuser may hold BYPASSRLS. Managed Postgres
  // platforms retain internal administrative roles with BYPASSRLS; those roles are not application
  // identities and cannot be governed by our migrations. The runtime/provisioner checks remain
  // explicit, and this query catches any other app_* role that accidentally gains the attribute.
  const bypass = await db.query(
    "SELECT rolname FROM pg_roles WHERE rolbypassrls = true AND rolname LIKE 'app\\_%' ESCAPE '\\'",
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

  // 7. Ledger write-time enforcement (0007) — the balance/balanced/single-currency invariants are
  // correct-by-construction via triggers, not app-code. Assert both exist (the rejection behavior
  // itself is proven in ledger-write-time.integration.spec.ts).
  const REQUIRED_TRIGGERS = [
    "trg_ledger_txn_balanced",
    "trg_ledger_apply_entry",
    // Corporate general ledger (ADR-0013, migration 0112). These carry MORE weight than the
    // subledger's: GL immutability is enforced by trigger ALONE, because `prepareRoles()` re-grants
    // full DML to app_provisioner on every deploy, so a privilege-based guarantee would not survive.
    // If one of these is missing or disabled, posted company history is rewritable.
    "trg_gl_journal_complete",
    "trg_gl_journal_filled",
    "trg_gl_journals_immutable",
    "trg_gl_journal_lines_immutable",
    "trg_gl_journals_no_truncate",
    "trg_gl_journal_lines_no_truncate",
  ];
  const trigs = await db.query(
    `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (${REQUIRED_TRIGGERS.map((t) => `'${t}'`).join(", ")})`,
  );
  const trigNames = new Set(trigs.rows.map((r) => String(r.tgname)));
  for (const t of REQUIRED_TRIGGERS) {
    if (!trigNames.has(t))
      violations.push(
        `ledger enforcement trigger '${t}' is missing — a write-time invariant (0007 / 0112) is not applied`,
      );
  }

  // 7. (ADR-0013 #2) The corporate general ledger is COMPANY data. The tenant-facing role must hold
  // nothing on it, and the control plane must hold no way to rewrite it.
  //
  // WHY THIS IS ASSERTED ON EVERY DEPLOY rather than trusted from the migration: `prepareRoles()` in
  // src/cloud-migrate.ts runs BEFORE migrate() on every deploy and unconditionally issues
  // `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_provisioner`.
  // Migration 0112 revokes those, but it is journaled and so runs exactly once. Without this check,
  // deploy N would leave the correct state and deploy N+1 would silently re-grant, with nothing
  // failing. `has_table_privilege` is used rather than `role_table_grants` so privileges inherited via
  // role membership are counted too.
  // The posting airlock (0114). The tenant-facing role may INSERT and nothing else — that asymmetry IS
  // the seam, and like every other grant it is restored broadly by prepareRoles on each deploy, so it
  // has to be re-asserted rather than trusted from the migration.
  const airlockRuntime = await db.query(`
    SELECT p AS priv FROM unnest(ARRAY['SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
    WHERE has_table_privilege('${RUNTIME_ROLE}', 'gl_posting_requests', p)
  `);
  for (const r of airlockRuntime.rows) {
    violations.push(
      `'${RUNTIME_ROLE}' holds ${r.priv} on gl_posting_requests — the posting airlock must be INSERT-only from the tenant side`,
    );
  }
  const airlockInsert = await db.query(
    `SELECT has_table_privilege('${RUNTIME_ROLE}', 'gl_posting_requests', 'INSERT') AS ok`,
  );
  if (airlockInsert.rows[0]?.ok !== true) {
    violations.push(
      `'${RUNTIME_ROLE}' cannot INSERT into gl_posting_requests — money movements cannot reach the books`,
    );
  }
  // Deleting a still-pending request destroys a movement's only path to the books, and no reconciliation
  // exists to notice. The FK cascade does not need this privilege (referential actions bypass it).
  const airlockDelete = await db.query(
    `SELECT has_table_privilege('app_provisioner', 'gl_posting_requests', 'DELETE') AS held`,
  );
  if (airlockDelete.rows[0]?.held === true) {
    violations.push(
      "'app_provisioner' holds DELETE on gl_posting_requests — a queued movement could be dropped before it posts (did prepareRoles re-grant?)",
    );
  }

  for (const table of ["gl_accounts", "gl_journals", "gl_journal_lines"]) {
    const runtimeReach = await db.query(`
      SELECT p AS priv FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
      WHERE has_table_privilege('${RUNTIME_ROLE}', '${table}', p)
    `);
    for (const r of runtimeReach.rows) {
      violations.push(
        `'${RUNTIME_ROLE}' holds ${r.priv} on ${table} — the tenant-facing role must not reach the company books at all`,
      );
    }
    const provisionerRewrite = await db.query(`
      SELECT p AS priv FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) AS p
      WHERE has_table_privilege('app_provisioner', '${table}', p)
    `);
    for (const r of provisionerRewrite.rows) {
      violations.push(
        `'app_provisioner' holds ${r.priv} on ${table} — posted company history must be append-only (did prepareRoles re-grant?)`,
      );
    }
  }

  // 8. (ADR-0012) Commercial configuration — the catalog, its offers, and which catalog a workspace
  // buys from — is staff-authored control-plane state. The tenant-facing role must not reach it: read
  // access leaks other workspaces' negotiated prices, and write access would let a workspace author
  // its own. Migrations 0110 and 0117 revoke it; asserted here because `ALTER DEFAULT PRIVILEGES`
  // (0001) grants app_runtime DML on every table the migrator creates, so the REVOKE is the only thing
  // standing between a new commercial table and the tenant role — and a journaled migration runs once.
  //
  // `token_purchases` (0128) joins the list for the SAME reason, not a stronger one: none of these five
  // tables has row-level security or a single policy, so grants are the entire boundary for every one
  // of them. What makes this one urgent is the payload — the row carries `offer_snapshot` and
  // `price_per_pack_minor_locked` (a workspace's negotiated package terms), `amount_minor`, and the
  // buyer's `email` — and it is the provenance `grantTokensForPurchase` reconciles against precisely
  // because a webhook payload cannot be trusted.
  for (const table of [
    "commercial_offer_channels",
    "pricing_offers",
    "pricing_offer_versions",
    "offer_catalog_assignments",
    "token_purchases",
    // 0129 — the same class again, on the two worst of the remaining ten. `payments` is cross-tenant
    // financial disclosure and, because settlement reads it to decide what to credit, a forged top-up.
    // `staff_users` is not tenant-scoped at all, so no policy could ever protect it: read is the
    // operator roster, and write manufactures the second approver maker-checker relies on, since
    // `pricing_offer_versions.created_by`/`approved_by` are real FKs to it.
    "payments",
    "staff_users",
    // 0130 — `price_book_rates.unit_price_minor` IS the charge, read on the send path through
    // `EffectivePricingService`. A writable rate table is a pricing-integrity hole, not a disclosure
    // one: the tenant-facing role could zero its own unit price and send for nothing, with every
    // ledger movement internally consistent at the fabricated price. 0107 already revoked the
    // neighbouring `price_book_versions` / `pricing_sell_rules` / `provider_cost_rates`; these two
    // were missed, and that asymmetry is what surfaced them.
    "price_books",
    "price_book_rates",
    // 0131 — the same class a fourth time, found by asking Postgres directly
    // (`has_table_privilege` against `relrowsecurity`) instead of reading comments. All four carry a
    // `tenant_id` column and NO row-level security, so the column looked like protection and was
    // none. `auto_topup` and `payment_authorizations` are the auto-top-up mechanism: writable, they
    // are an instruction to charge somebody else's saved card. `plugin_instances` names the vendor
    // every channel dispatches through plus the pointer to its encrypted secret, so write is
    // re-routing the platform's traffic. `proposals` IS maker-checker, and write to it defeats the
    // separation of duties the queue exists to enforce.
    "auto_topup",
    "payment_authorizations",
    "plugin_instances",
    "proposals",
    // 0132 — the last two of this class, and the two whose comments each cited a SIBLING as the
    // reason they were safe: kill-switches.ts named `plugin_instances`, audit.ts named
    // `staff_users` and `plugin_instances`. All three of those were themselves holes when the
    // comments were written. `kill_switches` IS the incident control, so write access is both a
    // denial of service and a way to resume traffic staff halted; `audit_events` is a trail the
    // audited party could otherwise rewrite or delete.
    "kill_switches",
    "audit_events",
    // 0145 — control-plane by construction: it spans every tenant on the shared WABA, and its
    // rows are inbound messages nobody could be attributed to (ADR-0015 §1). The tenant-facing
    // role reading it would be reading that OTHER workspaces' consumers wrote in.
    "whatsapp_unattributed_inbound",
  ]) {
    const runtimeReach = await db.query(`
      SELECT p AS priv FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
      WHERE has_table_privilege('${RUNTIME_ROLE}', '${table}', p)
    `);
    for (const r of runtimeReach.rows) {
      violations.push(
        `'${RUNTIME_ROLE}' holds ${r.priv} on ${table} — commercial catalog and purchase state must be unreachable from the tenant-facing role`,
      );
    }
  }

  // 8b. (0132) `audit_events` append-only, from the PROVISIONER side. The loop above proves the
  // tenant-facing role holds nothing on it, which says nothing about the role that actually writes
  // the trail. 0132 granted SELECT + INSERT and withheld UPDATE/DELETE in a comment that openly
  // admitted it enforced nothing: prepareRoles() re-grants full DML on ALL TABLES before every
  // migrate(), so the narrowing lapsed on the very next deploy. cloud-migrate-privileges.ts now
  // re-asserts it after migrations; this is the check that proves the re-assertion actually ran.
  const auditRewrite = await db.query(`
    SELECT p AS priv FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) AS p
    WHERE has_table_privilege('app_provisioner', 'audit_events', p)
  `);
  for (const r of auditRewrite.rows) {
    violations.push(
      `'app_provisioner' holds ${r.priv} on audit_events — the audit trail must be append-only (did prepareRoles re-grant?)`,
    );
  }
  // A trail nothing can write is equally broken, and a too-aggressive REVOKE would look identical to
  // success here. Assert the positive half in the same breath.
  const auditInsert = await db.query(
    `SELECT has_table_privilege('app_provisioner', 'audit_events', 'INSERT') AS held`,
  );
  if (auditInsert.rows[0]?.held !== true) {
    violations.push(
      "'app_provisioner' cannot INSERT into audit_events — no audit row could be recorded at all",
    );
  }

  // 8c. (ADR-0015) The inbound pair is INSERT/UPDATE-only for the tenant-facing role. An inbound
  // message is the evidence a conversation happened, and the service window is what authorises a
  // free-form reply — deleting a window row would let a workspace erase the record of when its right
  // to send expired. Asserted in BOTH directions: the REVOKE landed AND the writes it needs survived,
  // because a REVOKE that took INSERT with it would break ingestion in a way no read-only check sees.
  for (const table of [
    "whatsapp_inbound_messages",
    "whatsapp_service_windows",
  ]) {
    const forbidden = await db.query(`
      SELECT p AS priv FROM unnest(ARRAY['DELETE','TRUNCATE']) AS p
      WHERE has_table_privilege('${RUNTIME_ROLE}', '${table}', p)
    `);
    for (const r of forbidden.rows) {
      violations.push(
        `'${RUNTIME_ROLE}' holds ${r.priv} on ${table} — inbound evidence and the service window are not the tenant-facing role's to destroy`,
      );
    }
    const required = await db.query(`
      SELECT p AS priv FROM unnest(ARRAY['SELECT','INSERT','UPDATE']) AS p
      WHERE NOT has_table_privilege('${RUNTIME_ROLE}', '${table}', p)
    `);
    for (const r of required.rows) {
      violations.push(
        `'${RUNTIME_ROLE}' LACKS ${r.priv} on ${table} — inbound ingestion cannot work without it`,
      );
    }
  }

  // 8d. (0149) The message/delivery EVIDENCE tables are INSERT/UPDATE-only for the tenant-facing role.
  //
  // 0001 grants app_runtime full DML on ALL TABLES and sets ALTER DEFAULT PRIVILEGES to keep doing it,
  // so DELETE is present until a migration takes it away — and a GRANT cannot narrow anything, which is
  // why `GRANT SELECT, INSERT, UPDATE` in 0063 read like a restriction and was not one. Only the
  // WhatsApp pair had been closed (0135/0137); their migration recorded the rest as an open sweep.
  //
  // A message row is the ledger's `reference_id` target: delete it and a COMMITTED wallet transaction
  // is orphaned — the charge survives, the reason for it does not. A dispatch row is the recovery
  // intent, so losing it strands a reserve. An outbox event is an at-least-once promise to a webhook.
  //
  // Asserted in BOTH directions on purpose. A REVOKE that also took INSERT or UPDATE would break
  // sending outright while looking, to a check that only tests for absence, exactly like success.
  for (const table of [
    "messages",
    "email_messages",
    "message_dispatches",
    "email_dispatches",
    "message_deliveries",
    "message_delivery_attempts",
    "outbox_events",
  ]) {
    const destructive = await db.query(`
      SELECT p AS priv FROM unnest(ARRAY['DELETE','TRUNCATE']) AS p
      WHERE has_table_privilege('${RUNTIME_ROLE}', '${table}', p)
    `);
    for (const r of destructive.rows) {
      violations.push(
        `'${RUNTIME_ROLE}' holds ${r.priv} on ${table} — billing evidence and dispatch intent are not the tenant-facing role's to destroy`,
      );
    }
    const required = await db.query(`
      SELECT p AS priv FROM unnest(ARRAY['SELECT','INSERT','UPDATE']) AS p
      WHERE NOT has_table_privilege('${RUNTIME_ROLE}', '${table}', p)
    `);
    for (const r of required.rows) {
      violations.push(
        `'${RUNTIME_ROLE}' LACKS ${r.priv} on ${table} — sending cannot work without it`,
      );
    }
  }

  // Retention prunes expired managed deliveries through the PROVISIONING connection, so that role must
  // keep DELETE. Asserted because the revoke above is one careless edit away from taking it too, and
  // the symptom would be silent: rows accumulating past their retention window with nothing failing.
  for (const table of ["message_deliveries", "message_delivery_attempts"]) {
    const prune = await db.query(
      `SELECT has_table_privilege('app_provisioner', '${table}', 'DELETE') AS held`,
    );
    if (prune.rows[0]?.held !== true) {
      violations.push(
        `'app_provisioner' cannot DELETE from ${table} — the retention sweeper would silently stop pruning`,
      );
    }
  }

  // 9. (ADR-0012 §6/§8) Commercial write-time invariants. Unlike the grants above these survive a
  // re-grant, but they are asserted for the same reason the GL triggers are: if one is missing, a
  // published price is editable after purchase, or a workspace can be pointed at a catalog whose
  // offers no purchase can ever resolve.
  const COMMERCIAL_TRIGGERS = [
    "protect_published_pricing_offer_version_trigger",
    "assert_offer_catalog_assignment_mode_trigger",
    "assert_pricing_offer_catalog_mode_trigger",
    "protect_referenced_price_book_mode_trigger",
  ];
  const commercialTrigs = await db.query(
    `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (${COMMERCIAL_TRIGGERS.map((t) => `'${t}'`).join(", ")})`,
  );
  const commercialNames = new Set(
    commercialTrigs.rows.map((r) => String(r.tgname)),
  );
  for (const t of COMMERCIAL_TRIGGERS) {
    if (!commercialNames.has(t)) {
      violations.push(
        `commercial-offer trigger '${t}' is missing — a published-price or catalog-mode invariant (0110 / 0117) is not applied`,
      );
    }
  }

  // 10. Recognition allocations are financial evidence. The data-plane may append them in the same
  // transaction as settlement, but neither application role may rewrite/delete them and the control
  // plane may not fabricate them. `prepareRoles()` broadens provisioner grants before each deploy, so
  // cloud-migrate restores this posture after migrations and this assertion proves it stayed restored.
  const allocationInsert = await db.query(
    `SELECT has_table_privilege('${RUNTIME_ROLE}', 'token_recognition_allocations', 'INSERT') AS ok`,
  );
  if (allocationInsert.rows[0]?.ok !== true) {
    violations.push(
      `'${RUNTIME_ROLE}' cannot INSERT token_recognition_allocations — committed usage cannot reach exact revenue recognition`,
    );
  }
  for (const [roleName, forbidden] of [
    [RUNTIME_ROLE, ["UPDATE", "DELETE", "TRUNCATE"]],
    ["app_provisioner", ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]],
  ] as const) {
    const held = await db.query(`
      SELECT p AS priv FROM unnest(ARRAY[${forbidden.map((privilege) => `'${privilege}'`).join(", ")}]) AS p
      WHERE has_table_privilege('${roleName}', 'token_recognition_allocations', p)
    `);
    for (const row of held.rows) {
      violations.push(
        `'${roleName}' holds ${row.priv} on token_recognition_allocations — recognition history must be append-only`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

export function formatSecurityViolations(r: SecurityLayerResult): string {
  return r.ok
    ? "security layer applied ✓ (non-owner role, FORCE RLS + policy on every tenant table, ledger append-only)"
    : `security layer NOT correctly applied:\n${r.violations.map((v) => `  ✗ ${v}`).join("\n")}`;
}
