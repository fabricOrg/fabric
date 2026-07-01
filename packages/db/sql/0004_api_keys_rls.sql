-- ================================================================================================
-- API-KEY RLS (F2.3, L2) — tenant isolation for api_keys + the possession-scoped auth-lookup policy.
-- Sibling of sql/0001 + 0002. Bound to the ratified (B-policy) decision.
--
-- WHY (B-policy), not a SECURITY DEFINER resolver: the auth lookup must resolve WHICH tenant owns a
-- presented key (pre-tenant, cross-tenant). A SECURITY DEFINER owned by app_owner does NOT bypass
-- FORCE RLS (Postgres subjects even the owner to policies under FORCE; only a BYPASSRLS role escapes)
-- — verified: it returns 0 rows in prod (app_owner is non-superuser). Instead we add a second
-- PERMISSIVE, SELECT-only policy that exposes ONLY the row whose hash the caller PRESENTS. Result:
-- ZERO SECURITY DEFINER, ZERO BYPASSRLS — you can read a key row iff you hold the raw key.
--
-- HOW TO WIRE IT IN (same flow as 0001/0002):
--   1) pnpm db:generate                     # emits the api_keys table DDL from the typed schema
--   2) drizzle-kit generate --custom --name api_keys_rls
--   3) paste this file into the new migrations/000X_api_keys_rls.sql
--   4) pnpm db:migrate
-- ================================================================================================

-- api_keys is a TENANT table (no exception to the every-tenant-table-has-RLS invariant).
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE  ROW LEVEL SECURITY;

-- ---- Policy 1: tenant management (list / revoke / create) --------------------------------------
-- Classic tenant scoping — the same shape as 0001/0002. Used when the request runs inside
-- withTenant (app.tenant_id set): a tenant sees/edits only its own keys.
CREATE POLICY tenant_isolation ON api_keys
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---- Policy 2: possession-scoped auth lookup (the pre-tenant resolve) --------------------------
-- SELECT-only. The api-key guard opens a tiny tx, sets `app.api_key_hash` (transaction-scoped,
-- parameterized — see withApiKeyLookup), and selects: this policy exposes ONLY the row whose
-- key_hash equals the PRESENTED hash. current_setting(...,true) → NULL when unset → `key_hash = NULL`
-- matches nothing (fail-closed). Since key_hash is SHA-256 (high-entropy, UNIQUE), a caller can read
-- a key row iff it already holds the raw key → no cross-tenant discovery. No SECURITY DEFINER needed.
CREATE POLICY api_key_auth_lookup ON api_keys
  FOR SELECT
  USING (key_hash = current_setting('app.api_key_hash', true));

-- Policies are PERMISSIVE (OR'd): the auth context (api_key_hash set, no tenant) matches only policy
-- 2; the management context (tenant_id set, no api_key_hash) matches only policy 1; neither set → 0
-- rows. The two contexts are disjoint by construction. `uniq_api_key_hash` (typed schema) is the
-- index the lookup's key_hash equality rides.

-- ================================================================================================
-- Runtime patterns:
--   AUTH (guard, pre-tenant):  db.withApiKeyLookup(sha256(rawKey), tx =>
--     tx`SELECT tenant_id, scopes FROM api_keys WHERE status = 'active'`)  -- 0 or 1 row
--   then everything else runs via db.withTenant(tenant_id, ...); last_used_at is bumped there
--   (the tenant's own key → tenant_isolation permits the UPDATE; no bypass).
-- ================================================================================================
