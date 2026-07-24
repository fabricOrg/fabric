ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE email_messages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON email_messages FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY provisioner_read ON email_messages FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON email_messages TO app_runtime;--> statement-breakpoint
GRANT SELECT ON email_messages TO app_provisioner;--> statement-breakpoint

ALTER TABLE email_dispatches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE email_dispatches FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON email_dispatches FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY provisioner_read ON email_dispatches FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON email_dispatches TO app_runtime;--> statement-breakpoint
GRANT SELECT ON email_dispatches TO app_provisioner;
