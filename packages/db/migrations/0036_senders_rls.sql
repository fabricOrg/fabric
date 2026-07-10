-- ================================================================================================
-- SENDERS RLS — tenant isolation for the sender-id registry (E10). Sibling of 0004/0034: table
-- DDL comes from the typed-schema migration (0035); this adds RLS + the runtime grant. Staff
-- decisions run on the provisioning connection, which needs its own permissive policy (RDS
-- forbids BYPASSRLS — same shape as 0013).
-- ================================================================================================

ALTER TABLE senders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE senders FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON senders;--> statement-breakpoint
CREATE POLICY tenant_isolation ON senders FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Staff review reads/decides ACROSS tenants on the provisioning role.
DROP POLICY IF EXISTS provisioner_all ON senders;--> statement-breakpoint
CREATE POLICY provisioner_all ON senders FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON senders TO app_runtime;--> statement-breakpoint
GRANT SELECT, UPDATE ON senders TO app_provisioner;
