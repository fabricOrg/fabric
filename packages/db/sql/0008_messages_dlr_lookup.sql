-- ================================================================================================
-- MESSAGES DLR-LOOKUP POLICY (F5.4, L5 HTTP) — possession-scoped resolve for the DLR webhook.
-- A provider DLR arrives with only (provider_slug, provider_ref) and NO tenant context. Rather than a
-- SECURITY DEFINER (would break the zero-definer gate), a permissive SELECT policy exposes ONLY the
-- message whose provider_ref the caller PRESENTS — the same (B-policy) shape as api_keys. The webhook
-- itself is authenticated by the provider signature (verifyWebhook); this just scopes WHICH message.
-- Custom migration (RLS policy). NULLIF-hardened (empty GUC → NULL → 0 rows, no throw).
-- ================================================================================================

CREATE POLICY dlr_provider_ref_lookup ON messages
  FOR SELECT
  USING (provider_ref = NULLIF(current_setting('app.provider_ref', true), ''));

-- Composition (both PERMISSIVE, OR'd): DLR context (app.provider_ref set, no tenant) matches ONLY
-- this policy → the single presented-ref row; tenant/mgmt context (app.tenant_id set, no provider_ref)
-- matches ONLY tenant_isolation → own messages; neither set → 0 rows (fail-closed). Disjoint by
-- construction. After the resolve, the DLR handler runs ingestDlr via withTenant(resolved tenant_id).
