-- Managed deliveries and attempts are data-plane tenant records. FORCE RLS protects every read,
-- worker update, retention delete, and callback reconciliation even if an application predicate is
-- accidentally omitted. The provisioner policy exists because RDS cannot grant BYPASSRLS.

ALTER TABLE message_deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_deliveries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON message_deliveries;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_deliveries FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON message_deliveries;--> statement-breakpoint
CREATE POLICY provisioner_all ON message_deliveries FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_deliveries TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_deliveries TO app_provisioner;--> statement-breakpoint

ALTER TABLE message_delivery_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_delivery_attempts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON message_delivery_attempts;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_delivery_attempts FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON message_delivery_attempts;--> statement-breakpoint
CREATE POLICY provisioner_all ON message_delivery_attempts FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_delivery_attempts TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_delivery_attempts TO app_provisioner;
