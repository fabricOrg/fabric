ALTER TABLE sandbox_usage_buckets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sandbox_usage_buckets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON sandbox_usage_buckets FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY provisioner_read ON sandbox_usage_buckets FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint
REVOKE ALL PRIVILEGES ON sandbox_usage_buckets FROM app_runtime, app_provisioner;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sandbox_usage_buckets TO app_runtime;--> statement-breakpoint
GRANT SELECT ON sandbox_usage_buckets TO app_provisioner;--> statement-breakpoint

ALTER TABLE sandbox_usage_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sandbox_usage_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON sandbox_usage_events FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY provisioner_read ON sandbox_usage_events FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint
REVOKE ALL PRIVILEGES ON sandbox_usage_events FROM app_runtime, app_provisioner;--> statement-breakpoint
GRANT SELECT, INSERT ON sandbox_usage_events TO app_runtime;--> statement-breakpoint
GRANT SELECT ON sandbox_usage_events TO app_provisioner;
