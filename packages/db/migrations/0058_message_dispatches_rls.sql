ALTER TABLE message_dispatches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_dispatches FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON message_dispatches;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_dispatches FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DROP POLICY IF EXISTS provisioner_read ON message_dispatches;--> statement-breakpoint
CREATE POLICY provisioner_read ON message_dispatches FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON message_dispatches TO app_runtime;--> statement-breakpoint
GRANT SELECT ON message_dispatches TO app_provisioner;
