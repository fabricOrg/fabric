-- ADR-0010 Phase 2 (slice 2b) — tenancy for token holds.
--
-- A hold is a data-plane tenant record written on the send path and resolved by the delivery callback
-- and the sweeper, so FORCE RLS protects every one of those writes even if an application predicate
-- is accidentally omitted. The provisioner policy exists because RDS cannot grant BYPASSRLS, and the
-- sweeper discovers stuck holds across tenants on the provisioning connection before resolving each
-- inside withTenant.

ALTER TABLE token_holds ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE token_holds FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON token_holds;--> statement-breakpoint
CREATE POLICY tenant_isolation ON token_holds FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON token_holds;--> statement-breakpoint
CREATE POLICY provisioner_all ON token_holds FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON token_holds TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON token_holds TO app_provisioner;
