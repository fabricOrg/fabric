-- ================================================================================================
-- WHATSAPP PROVIDER-REF LOOKUP POLICY — the sibling of 0008_messages_dlr_lookup for WhatsApp.
--
-- A Meta status callback arrives with only (provider_slug, provider_ref) and NO tenant context, so
-- finding the owning message is inherently cross-tenant. `withProviderRefLookup` binds
-- `app.provider_ref` and relies on a permissive SELECT policy to expose ONLY the presented row —
-- deliberately not a SECURITY DEFINER, which would break the zero-definer gate asserted in
-- security-layer.check.ts.
--
-- WITHOUT THIS POLICY the webhook cannot see the message at all: FORCE RLS is on, the DLR context
-- sets no `app.tenant_id`, so `tenant_isolation` matches nothing and the lookup returns zero rows.
-- The ingress then answers 404 for a perfectly valid Meta callback — which is exactly how the Phase
-- 1e integration tests failed, and it would have presented in production as delivery statuses
-- silently never arriving.
--
-- Composition (both PERMISSIVE, OR'd): callback context (app.provider_ref set, no tenant) matches
-- only this policy → the single presented-ref row; tenant context (app.tenant_id set, no
-- provider_ref) matches only tenant_isolation → own messages; neither set → 0 rows, fail-closed.
-- NULLIF-hardened so an empty GUC on a pooled connection yields NULL → 0 rows rather than an error.
-- ================================================================================================

DROP POLICY IF EXISTS dlr_provider_ref_lookup ON whatsapp_messages;--> statement-breakpoint
CREATE POLICY dlr_provider_ref_lookup ON whatsapp_messages
  FOR SELECT
  USING (provider_ref = NULLIF(current_setting('app.provider_ref', true), ''));
