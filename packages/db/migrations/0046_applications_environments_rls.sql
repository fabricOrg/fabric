-- ================================================================================================
-- APPLICATIONS / ENVIRONMENTS RLS (ADR-0004). Table DDL comes from the typed-schema migration
-- (0045); this adds RLS + runtime grants. The RLS isolation boundary does NOT move — it stays the
-- workspace/tenant. These are tenant-scoped tables carrying tenant_id, so they join the SAME
-- tenant_isolation policy shape as every other tenant table (0002/0004/0036).
--
-- Provisioning (self-serve + ops) creates workspace -> default application -> sandbox environment
-- BEFORE any tenant context is set, on the app_provisioner connection — so, like accounts/users/
-- memberships (0013) and senders (0036), each table also gets a permissive provisioner_all policy.
-- RLS policies are PERMISSIVE and OR'd, so provisioner_all lets ONLY app_provisioner through while
-- app_runtime stays fully tenant-isolated. Idempotent (DROP POLICY IF EXISTS) for safe re-run.
-- ================================================================================================

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE applications FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON applications;--> statement-breakpoint
CREATE POLICY tenant_isolation ON applications FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DROP POLICY IF EXISTS provisioner_all ON applications;--> statement-breakpoint
CREATE POLICY provisioner_all ON applications FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint

ALTER TABLE environments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE environments FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON environments;--> statement-breakpoint
CREATE POLICY tenant_isolation ON environments FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DROP POLICY IF EXISTS provisioner_all ON environments;--> statement-breakpoint
CREATE POLICY provisioner_all ON environments FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON applications TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON applications TO app_provisioner;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON environments TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON environments TO app_provisioner;
