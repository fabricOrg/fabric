-- ================================================================================================
-- RLS + ROLES — the tenant-isolation security foundation (pre-impl review B3 & B4)
--
-- WHY raw SQL (not Drizzle): roles, RLS, FORCE RLS, and policies are not expressible in Drizzle's
-- TypeScript DSL. So tables come from the typed schema (drizzle generate); THIS file adds the
-- security layer on top. It must run AFTER the table-creating migration.
--
-- HOW TO WIRE IT IN (so drizzle-kit tracks it in its migration journal):
--   1) pnpm db:generate                     # generates table DDL from the typed schema
--   2) pnpm --filter @app/db exec drizzle-kit generate --custom --name rls_and_roles
--   3) paste this file's contents into the new migrations/000X_rls_and_roles.sql
--   4) pnpm db:migrate
--
-- THE MODEL (two layers of defense):
--   - App connects as a NON-OWNER role (app_runtime) that lacks BYPASSRLS → it cannot see past RLS. (B4)
--   - Tenant context is set per-transaction via `SET LOCAL app.tenant_id = '<uuid>'`. Policies read
--     it with current_setting('app.tenant_id', true). If it's unset → NULL → 0 rows (fail-closed). (B3)
-- ================================================================================================

-- ---- 1. The runtime application role (NON-owner, NO BYPASSRLS) ----------------------------------
-- Idempotent so the migration is safe to re-run. Local uses a password; in cloud the role is created
-- without a static password and authenticated via IAM / a secret from Secrets Manager.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'localdev_app';  -- local only; rotate/replace in cloud
  END IF;
END
$$;

-- Least privilege: the app may connect + use the schema + CRUD rows, but does NOT own tables
-- (ownership would bypass RLS) and cannot create/drop schema objects.
GRANT CONNECT ON DATABASE app TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- Future tables (created later by the owner) auto-grant to the app role — so we don't forget.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- ---- 2. Enable RLS + FORCE on every tenant table ------------------------------------------------
-- ENABLE turns policies on for non-owners. FORCE also subjects the table OWNER to policies, so even
-- if something connects as owner it can't silently bypass isolation (defense in depth — B4).
ALTER TABLE accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts    FORCE  ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE  ROW LEVEL SECURITY;
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE users       FORCE  ROW LEVEL SECURITY;

-- ---- 3. Policies --------------------------------------------------------------------------------
-- current_setting('app.tenant_id', true): the `true` = missing_ok → returns NULL (no error) when the
-- GUC isn't set. NULL comparison yields no rows → a query with no tenant context sees NOTHING.

-- accounts: a tenant sees only its own row (accounts.id IS the tenant id).
CREATE POLICY tenant_isolation ON accounts
  FOR ALL
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

-- memberships: classic tenant_id scoping. USING gates reads/updates/deletes; WITH CHECK gates writes
-- so a tenant can't INSERT a row tagged with someone else's tenant_id.
CREATE POLICY tenant_isolation ON memberships
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- users: NUANCE — a user has no tenant_id (they can belong to many tenants via memberships). So a
-- user row is visible to the current tenant only if a membership links them. This is the
-- multi-tenant-identity subtlety made explicit.
CREATE POLICY tenant_visibility ON users
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id
        AND m.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- ---- 4. Privacy domain tables (all tenant_id-scoped) --------------------------------------------
-- data_subjects, dek_keys, pii_vault, erasure_log each carry tenant_id → same isolation policy.
-- (Defense in depth: even though PII is encrypted, RLS still stops one tenant reading another's vault.)
ALTER TABLE data_subjects ENABLE ROW LEVEL SECURITY;  ALTER TABLE data_subjects FORCE ROW LEVEL SECURITY;
ALTER TABLE dek_keys      ENABLE ROW LEVEL SECURITY;  ALTER TABLE dek_keys      FORCE ROW LEVEL SECURITY;
ALTER TABLE pii_vault     ENABLE ROW LEVEL SECURITY;  ALTER TABLE pii_vault     FORCE ROW LEVEL SECURITY;
ALTER TABLE erasure_log   ENABLE ROW LEVEL SECURITY;  ALTER TABLE erasure_log   FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON data_subjects FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON dek_keys FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON pii_vault FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON erasure_log FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ================================================================================================
-- Runtime pattern (enforced in the app's data layer, see F1.1):
--   BEGIN;
--     SET LOCAL app.tenant_id = '<tenant-uuid>';   -- FIRST statement, transaction-scoped
--     ... tenant-scoped queries ...                -- RLS now filters every one
--   COMMIT;
-- SET LOCAL (not plain SET) is mandatory: under transaction-pooling (PgBouncer/RDS Proxy) a plain
-- SET would leak the tenant to the next request on that pooled connection (B3). A CI test must
-- interleave two tenants on one pooled connection and assert zero leakage.
-- ================================================================================================
