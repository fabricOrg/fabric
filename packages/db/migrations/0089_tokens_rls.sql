-- ADR-0010 Phase 2 (slice 2a) — tenancy for the token count layer.
--
-- token_lots and token_counters are DATA-PLANE tenant records: the send path will read and lock them
-- per request, so FORCE RLS protects every read, grant, hold, and sweep even if an application
-- predicate is accidentally omitted. The provisioner policy exists because RDS cannot grant BYPASSRLS.
--
-- token_purchases is deliberately NOT here: like `payments`, it is platform-level, because the
-- provider webhook carries no tenant context and must look the intent up by `reference` to learn
-- which tenant to grant. It is reached only through the elevated provisioning connection.

ALTER TABLE token_lots ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE token_lots FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON token_lots;--> statement-breakpoint
CREATE POLICY tenant_isolation ON token_lots FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON token_lots;--> statement-breakpoint
CREATE POLICY provisioner_all ON token_lots FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON token_lots TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON token_lots TO app_provisioner;--> statement-breakpoint

ALTER TABLE token_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE token_counters FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON token_counters;--> statement-breakpoint
CREATE POLICY tenant_isolation ON token_counters FOR ALL TO app_runtime
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_all ON token_counters;--> statement-breakpoint
CREATE POLICY provisioner_all ON token_counters FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON token_counters TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON token_counters TO app_provisioner;--> statement-breakpoint

-- The purchase intent is provisioner-only (no runtime grant): nothing on the data plane should be
-- able to read or forge a purchase row.
GRANT SELECT, INSERT, UPDATE ON token_purchases TO app_provisioner;
