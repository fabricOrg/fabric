-- Managed message definitions (SDK-003). Tenant-scoped -> FORCE RLS on all three tables, mirroring the
-- app/env + webhooks pattern. The runtime role (app_runtime, NON-superuser, cannot bypass RLS) is the
-- boundary; the provisioner keeps a permissive policy for cross-tenant operator/maintenance reads.
--
-- Authority note (ADR-0005 #6): drafting/publishing is gated to a dashboard-session role at the API
-- layer, NOT at the database role — management writes still run as app_runtime inside withTenant. The
-- GRANTs below therefore give app_runtime write access; the runtime-vs-management split is enforced by
-- the API guard (SDK-003 slice 4), not by these grants.
--
-- IMMUTABILITY (architecture-plan invariant "published content never changes"): message_definition_versions
-- grants app_runtime SELECT + INSERT only. The absence of UPDATE/DELETE makes a published version
-- unchangeable at the database level regardless of application code.

ALTER TABLE message_definitions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_definitions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON message_definitions;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_definitions FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON message_definitions;--> statement-breakpoint
CREATE POLICY provisioner_all ON message_definitions FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON message_definitions TO app_runtime;--> statement-breakpoint
-- A default-privilege grant (app_runtime=arwd) auto-grants full DML on every app_migrator-owned table.
-- Definitions are archived via a status change, never row-deleted, so revoke DELETE from the runtime role.
REVOKE DELETE ON message_definitions FROM app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_definitions TO app_provisioner;--> statement-breakpoint

ALTER TABLE message_definition_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_definition_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON message_definition_versions;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_definition_versions FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON message_definition_versions;--> statement-breakpoint
CREATE POLICY provisioner_all ON message_definition_versions FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint
-- SELECT + INSERT only: a published version is IMMUTABLE. The default-privilege grant hands app_runtime
-- UPDATE/DELETE too, so revoke them explicitly — this is what enforces immutability at the database level.
GRANT SELECT, INSERT ON message_definition_versions TO app_runtime;--> statement-breakpoint
REVOKE UPDATE, DELETE ON message_definition_versions FROM app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON message_definition_versions TO app_provisioner;--> statement-breakpoint
REVOKE UPDATE, DELETE ON message_definition_versions FROM app_provisioner;--> statement-breakpoint

ALTER TABLE message_definition_releases ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_definition_releases FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON message_definition_releases;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_definition_releases FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON message_definition_releases;--> statement-breakpoint
CREATE POLICY provisioner_all ON message_definition_releases FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint
-- SELECT + INSERT + UPDATE: re-releasing re-points version_id on the single (env, definition) row.
-- No DELETE for the runtime role (a release is superseded by UPDATE, not deleted).
GRANT SELECT, INSERT, UPDATE ON message_definition_releases TO app_runtime;--> statement-breakpoint
REVOKE DELETE ON message_definition_releases FROM app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_definition_releases TO app_provisioner;
