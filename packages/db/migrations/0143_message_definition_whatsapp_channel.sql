-- ================================================================================================
-- MANAGED MESSAGE DEFINITIONS — allow a version to target WhatsApp.
--
-- 0142 widened the DELIVERY side (message_deliveries / message_delivery_attempts); this widens the
-- AUTHORING side. Both were needed: without this a WhatsApp definition cannot be written at all, and
-- the managed send path would have nothing to resolve.
--
-- Hand-written for the same reason as 0142 — the snapshot chain is broken from 0135 onward, so
-- `drizzle-kit generate` errors. A CHECK cannot be widened in place, so it is dropped and recreated.
-- ================================================================================================

ALTER TABLE "message_definition_versions"
  DROP CONSTRAINT IF EXISTS "message_definition_version_channel_check";--> statement-breakpoint
ALTER TABLE "message_definition_versions"
  ADD CONSTRAINT "message_definition_version_channel_check"
  CHECK ("channel" in ('sms', 'email', 'whatsapp'));
