-- Sender bindings are tenant-owned environment configuration. Runtime management may create or
-- replace a binding, but rows are never deleted directly; definition/environment cascade retains
-- lifecycle integrity. FORCE RLS makes a missing tenant context fail closed.

ALTER TABLE message_definition_sender_bindings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_definition_sender_bindings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON message_definition_sender_bindings;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_definition_sender_bindings FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON message_definition_sender_bindings;--> statement-breakpoint
CREATE POLICY provisioner_all ON message_definition_sender_bindings FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON message_definition_sender_bindings TO app_runtime;--> statement-breakpoint
REVOKE DELETE ON message_definition_sender_bindings FROM app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_definition_sender_bindings TO app_provisioner;
