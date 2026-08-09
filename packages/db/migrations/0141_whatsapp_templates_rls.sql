ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE whatsapp_templates FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_templates;--> statement-breakpoint
CREATE POLICY tenant_isolation ON whatsapp_templates FOR SELECT TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_manage ON whatsapp_templates;--> statement-breakpoint
CREATE POLICY provisioner_manage ON whatsapp_templates FOR ALL TO app_provisioner
  USING (true)
  WITH CHECK (true);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator')
     AND EXISTS (
       SELECT 1 FROM pg_tables
       WHERE tablename = 'whatsapp_templates' AND tableowner <> 'app_migrator'
     ) THEN
    ALTER TABLE whatsapp_templates OWNER TO app_migrator;
  END IF;
END $$;--> statement-breakpoint
-- Template lifecycle is control-plane-ish tenant data: tenant-scoped reads are useful for send-time
-- enforcement, but rows are maintained by Meta sync/webhook ingestion. Explicitly remove DML that
-- app_runtime inherits from migrator default privileges so a tenant-facing path cannot forge approval.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON whatsapp_templates FROM app_runtime;--> statement-breakpoint
GRANT SELECT ON whatsapp_templates TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_templates TO app_provisioner;
