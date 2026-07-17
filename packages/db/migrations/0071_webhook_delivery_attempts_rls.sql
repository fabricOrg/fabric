ALTER TABLE webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE webhook_delivery_attempts FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON webhook_delivery_attempts;--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_delivery_attempts FOR SELECT TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DROP POLICY IF EXISTS provisioner_all ON webhook_delivery_attempts;--> statement-breakpoint
CREATE POLICY provisioner_all ON webhook_delivery_attempts FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint

GRANT SELECT ON webhook_delivery_attempts TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON webhook_delivery_attempts TO app_provisioner;
