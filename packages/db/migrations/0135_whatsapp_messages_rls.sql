ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE whatsapp_messages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_messages;--> statement-breakpoint
CREATE POLICY tenant_isolation ON whatsapp_messages FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_read ON whatsapp_messages;--> statement-breakpoint
CREATE POLICY provisioner_read ON whatsapp_messages FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator')
     AND EXISTS (
       SELECT 1 FROM pg_tables
       WHERE tablename = 'whatsapp_messages' AND tableowner <> 'app_migrator'
     ) THEN
    ALTER TABLE whatsapp_messages OWNER TO app_migrator;
  END IF;
END $$;--> statement-breakpoint
-- A GRANT cannot narrow anything. `ALTER DEFAULT PRIVILEGES` (0001) already handed app_runtime FULL
-- DML on every table the migrator creates, so listing SELECT/INSERT/UPDATE below leaves DELETE in
-- place — the REVOKE is the only thing that removes it. `0063_email_rls.sql` and `0004_sms_rls.sql`
-- both stop at the GRANT, so on a FRESH database app_runtime can DELETE from `messages` and
-- `email_messages` today. That is tracked separately as a sweep; this table does not inherit it.
--
-- WHY DELETE MATTERS HERE: a message row is the ledger's `reference_id` target and the billing/audit
-- evidence that a send happened. Deleting one orphans a committed wallet transaction and destroys the
-- only record of the charge. No application code deletes a message — the tenant-facing role has no
-- business holding the privilege.
--
-- WHY THIS READS CLEAN ON A DIRTY LOCAL DB: `ALTER DEFAULT PRIVILEGES` is grantor-scoped, so the hole
-- only appears on app_migrator-owned tables. An app_owner-owned local copy looks correct while a
-- freshly migrated CI/prod database does not. Assert with `has_table_privilege`, never by reading this
-- file.
REVOKE DELETE, TRUNCATE ON whatsapp_messages FROM app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON whatsapp_messages TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_messages TO app_provisioner;
