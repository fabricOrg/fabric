ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sms_templates FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON sms_templates;--> statement-breakpoint
CREATE POLICY tenant_isolation ON sms_templates FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON sms_templates TO app_runtime;
