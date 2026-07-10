-- ================================================================================================
-- OPT-OUTS RLS — tenant isolation for the consent registry (E10-S5). Sibling of 0034/0036.
-- ================================================================================================

ALTER TABLE opt_outs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE opt_outs FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON opt_outs;--> statement-breakpoint
CREATE POLICY tenant_isolation ON opt_outs FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON opt_outs TO app_runtime;
