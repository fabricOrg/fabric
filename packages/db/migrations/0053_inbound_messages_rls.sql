ALTER TABLE inbound_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE inbound_messages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON inbound_messages;--> statement-breakpoint
CREATE POLICY tenant_isolation ON inbound_messages FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY provisioner_read ON inbound_messages FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON inbound_messages TO app_runtime;--> statement-breakpoint
GRANT SELECT ON inbound_messages TO app_provisioner;
