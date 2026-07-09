-- ================================================================================================
-- PROVISIONER MAINTENANCE READ — cross-tenant READ-ONLY visibility for the scheduled maintenance
-- jobs (reservation sweeper discovery + the global ledger-invariant check). Sibling of 0013.
--
-- WHY: the API's maintenance job must (a) find WHICH tenants have messages stuck non-terminal past
-- the reservation TTL and (b) run the global trial-balance/projection invariant across ALL tenants.
-- Both are pure reads, but under FORCE RLS the tenant-scoped `app_runtime` role can only ever see
-- one tenant at a time. The provisioning connection (`app_provisioner`, no BYPASSRLS — RDS forbids
-- it) gets its reach from permissive policies, so we add SELECT-ONLY policies here.
--
-- LEAST PRIVILEGE, deliberately narrower than 0013's FOR ALL: maintenance never mutates through
-- the provisioner. All mutation (the sweep itself) happens per-tenant through @app/db `withTenant`
-- on `app_runtime`, keeping RLS as the write-path guard.
-- ================================================================================================

DROP POLICY IF EXISTS provisioner_read ON messages;--> statement-breakpoint
CREATE POLICY provisioner_read ON messages FOR SELECT TO app_provisioner USING (true);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_read ON ledger_entries;--> statement-breakpoint
CREATE POLICY provisioner_read ON ledger_entries FOR SELECT TO app_provisioner USING (true);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_read ON ledger_accounts;--> statement-breakpoint
CREATE POLICY provisioner_read ON ledger_accounts FOR SELECT TO app_provisioner USING (true);
