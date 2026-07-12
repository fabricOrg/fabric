-- ================================================================================================
-- REQUEST LOGS RLS (W-B). Table DDL comes from the typed-schema migration (0049); this adds RLS +
-- runtime grants. Isolation boundary stays the workspace/tenant — same tenant_isolation shape as
-- every other tenant table (0002/0046).
--
-- Two writers run on the app_provisioner connection (no per-request tenant session), so, like
-- accounts/applications (0013/0046), the table also gets a permissive provisioner_all policy:
--   * the request-log INTERCEPTOR INSERTs fire-and-forget off the send/charge hot path;
--   * the retention SWEEPER DELETEs across tenants past the window.
-- The query API READS per-tenant as app_runtime (SELECT only). Policies are PERMISSIVE and OR'd, so
-- provisioner_all lets ONLY app_provisioner through while app_runtime stays tenant-isolated.
-- Idempotent (DROP POLICY IF EXISTS) for safe re-run.
-- ================================================================================================

ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE request_logs FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON request_logs;--> statement-breakpoint
CREATE POLICY tenant_isolation ON request_logs FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DROP POLICY IF EXISTS provisioner_all ON request_logs;--> statement-breakpoint
CREATE POLICY provisioner_all ON request_logs FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint

GRANT SELECT ON request_logs TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON request_logs TO app_provisioner;
