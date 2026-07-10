-- ================================================================================================
-- VERIFY RLS — tenant isolation for the verifications table (V1, ADR-0002 golden path).
-- Sibling of 0004_sms_rls: the table DDL comes from the typed-schema migration (0033); this adds
-- the RLS layer + an explicit runtime grant (mirrors 0024's belt-and-braces on new tables).
-- ================================================================================================

ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE verifications FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

-- Classic tenant_id scoping; fail-closed (current_setting(...,true) → NULL → 0 rows when unset).
-- NULLIF('') hardening matches the 0001/0002/0004 policies.
DROP POLICY IF EXISTS tenant_isolation ON verifications;--> statement-breakpoint
CREATE POLICY tenant_isolation ON verifications FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON verifications TO app_runtime;
