-- ================================================================================================
-- WHATSAPP TEMPLATE CACHE — make the row identity TENANT-scoped, not WABA-scoped.
--
-- 0140 made the cache unique on (waba_id, name, language) with no tenant_id. On a SHARED WABA — the
-- aggregator model this platform runs (ADR-0015 §2) — that means one row per template globally, and
-- the sync upsert `ON CONFLICT (waba_id, name, language) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`
-- therefore REASSIGNS an existing row to whichever tenant synced last. The scheduler loops every
-- tenant on the WABA in a single tick, so the last one in the loop ends up owning every template and
-- every other tenant's compose picker silently goes empty.
--
-- The read side already assumed the opposite: listApprovedTemplates scopes by tenant_id through RLS
-- precisely BECAUSE the WABA is shared, and upsertWebhookEvent looks a row up by
-- (tenant_id, waba_id, name, language). Both want a row per tenant, which the old index forbade. The
-- code was right and the constraint was wrong, so the constraint moves.
--
-- Second failure this closes: for the tenant that lost the row, upsertWebhookEvent's SELECT missed,
-- fell through to an insert whose `ON CONFLICT ... DO NOTHING` swallowed it, and a template moving
-- APPROVED -> PAUSED never landed. A stale positive is exactly what must not happen before money
-- moves.
--
-- Safe on existing data: the new index is strictly weaker (same columns plus tenant_id), so no row
-- set that satisfied the old one can violate the new one. Created before the old one is dropped so
-- the table is never without a uniqueness guarantee.
--
-- Hand-written like 0142-0149 — the snapshot chain is broken from 0135 onward.
-- ================================================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_whatsapp_templates_tenant_waba_name_language"
  ON "whatsapp_templates" USING btree ("tenant_id", "waba_id", "name", "language");--> statement-breakpoint

DROP INDEX IF EXISTS "uniq_whatsapp_templates_waba_name_language";
