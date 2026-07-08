-- ================================================================================================
-- FLOW_RECORDS RLS — tenant isolation for the Lighthouse-flow transaction records. Sibling of the
-- wallet/message RLS files. The table is created by the typed-schema migration (0022 from
-- src/schema/flows.ts); this adds the security layer Drizzle's DSL can't express.
--
-- MODEL (identical to the other tenant tables): the app connects as non-owner `app_runtime`
-- (no BYPASSRLS); tenant context is set per-transaction via `SET LOCAL app.tenant_id`. Unset → NULL
-- → 0 rows (fail-closed). DEFAULT PRIVILEGES from 0001 already grant CRUD to app_runtime.
-- ================================================================================================

ALTER TABLE flow_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON flow_records FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
