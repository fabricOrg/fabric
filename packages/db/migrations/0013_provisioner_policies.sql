-- Cross-tenant provisioning access WITHOUT BYPASSRLS (RDS PostgreSQL forbids that attribute).
--
-- The identity/tenant provisioning connection (app_provisioner) must operate ABOVE tenant scope:
-- resolve a WorkOS org to an account before any tenant context exists, upsert users/memberships,
-- and create new accounts. Under FORCE ROW LEVEL SECURITY with no app.tenant_id set, the
-- tenant_isolation policy returns/permits nothing. RLS policies are PERMISSIVE and OR'd, so a
-- second policy scoped `TO app_provisioner` with USING (true) / WITH CHECK (true) lets ONLY that
-- role through — app_runtime stays fully tenant-isolated (this policy doesn't apply to it).
--
-- Scoped to exactly the tables provisioning touches (identity). Wallet/SMS/PII stay app_runtime-only.

-- Ensure the role exists so `TO app_provisioner` resolves. In the cloud, cloud-migrate already
-- created it (LOGIN) before running migrations; locally it may not exist (provisioning uses the
-- superuser app_owner), so create a benign NOLOGIN placeholder — the IF NOT EXISTS makes both paths
-- idempotent and never downgrades the cloud role's LOGIN.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_provisioner') THEN
    CREATE ROLE app_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON accounts;--> statement-breakpoint
CREATE POLICY provisioner_all ON accounts FOR ALL TO app_provisioner USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON users;--> statement-breakpoint
CREATE POLICY provisioner_all ON users FOR ALL TO app_provisioner USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON memberships;--> statement-breakpoint
CREATE POLICY provisioner_all ON memberships FOR ALL TO app_provisioner USING (true) WITH CHECK (true);
