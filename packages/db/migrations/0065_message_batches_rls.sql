ALTER TABLE message_batches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_batches FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_batches FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON message_batches TO app_runtime;--> statement-breakpoint

ALTER TABLE message_batch_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_batch_items FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_batch_items FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON message_batch_items TO app_runtime;
