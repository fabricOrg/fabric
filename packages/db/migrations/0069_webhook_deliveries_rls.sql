ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON webhook_deliveries;--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_deliveries FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DROP POLICY IF EXISTS provisioner_all ON webhook_deliveries;--> statement-breakpoint
CREATE POLICY provisioner_all ON webhook_deliveries FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint

GRANT SELECT, UPDATE ON webhook_deliveries TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON webhook_deliveries TO app_provisioner;
