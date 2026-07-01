-- ================================================================================================
-- SMS RLS — tenant isolation for the messages table (L5). Sibling of 0001/0002.
-- The messages table is created by the typed-schema migration (drizzle generate from
-- src/schema/sms.ts); this adds the RLS layer. Wire it as a custom migration after the table DDL,
-- same flow as 0002_wallet_rls.sql.
-- ================================================================================================

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE  ROW LEVEL SECURITY;

-- Classic tenant_id scoping; fail-closed (current_setting(...,true) → NULL → 0 rows when unset).
-- NULLIF(...,'') hardening (F6): an empty GUC on a reused pooled connection → NULL → 0 rows (clean
-- fail-closed), not a ''::uuid error. Matches the hardened 0001/0002 policies.
CREATE POLICY tenant_isolation ON messages FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- NOTE (DLR ingest, follow-up): a provider DLR webhook arrives with only (provider_slug, provider_ref)
-- and NO tenant context, so finding the owning message is inherently cross-tenant — the same shape as
-- api-key resolution (B4). It must go through a narrow SECURITY DEFINER resolver
-- `resolve_message_tenant(provider_slug, provider_ref) → tenant_id` (owner-owned, pinned search_path,
-- EXECUTE to app_runtime only) — the ONE audited bypass, after which ingestDlr runs inside
-- withTenant(tenant_id) under normal RLS. Deferred with the DLR HTTP ingress (see L5 delivery notes).
