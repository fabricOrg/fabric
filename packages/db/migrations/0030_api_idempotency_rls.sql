-- ================================================================================================
-- API_IDEMPOTENCY_KEYS RLS — tenant isolation for the client Idempotency-Key store. Sibling of the
-- wallet/message/flow_records RLS files: the table is created by the typed-schema migration (0029
-- from src/schema/api-idempotency.ts); this adds the security layer Drizzle's DSL can't express.
--
-- MODEL (identical to the other tenant tables): the app connects as non-owner `app_runtime`
-- (no BYPASSRLS); tenant context is set per-transaction via `SET LOCAL app.tenant_id`. Unset → NULL
-- → 0 rows (fail-closed) — a tenant can never read or replay another tenant's idempotency key.
-- DEFAULT PRIVILEGES from 0001 already grant CRUD to app_runtime.
--
-- The maintenance job purges expired keys cross-tenant on the provisioner connection: SELECT
-- (discovery parity with 0027) + DELETE (the purge). No INSERT/UPDATE — the provisioner never
-- creates or completes keys; only the tenant-scoped request path does.
-- ================================================================================================

ALTER TABLE api_idempotency_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE api_idempotency_keys FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON api_idempotency_keys FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DROP POLICY IF EXISTS provisioner_read ON api_idempotency_keys;--> statement-breakpoint
CREATE POLICY provisioner_read ON api_idempotency_keys FOR SELECT TO app_provisioner USING (true);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_purge ON api_idempotency_keys;--> statement-breakpoint
CREATE POLICY provisioner_purge ON api_idempotency_keys FOR DELETE TO app_provisioner USING (true);
