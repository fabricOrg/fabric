-- ================================================================================================
-- WHATSAPP DISPATCH — a terminal 'completed' status, so a finished dispatch stops claiming to be
-- mid-flight.
--
-- Observed on a real live send (2026-08-09): the message reached `delivered`, yet its dispatch row
-- read `status = 'sending'` with `completed_at` already set. `resolveWhatsappStatus` sets the
-- timestamp and never the status, and 'completed' was not even a legal value.
--
-- That was the cosmetic half. The functional half is why it matters: `pendingWhatsappDispatches` — the
-- recovery sweeper — filters on `status = 'pending'`, so a dispatch CRASHED between the claim and the
-- resolve is stuck at 'sending' forever and is never re-enqueued. Its wallet reserve is never
-- committed and never refunded. `message_dispatches` (SMS) does not have this hole because it has no
-- claim step at all; WhatsApp's claim was added deliberately to stop double-sends, and a claim without
-- lease expiry trades one failure for another.
--
-- Hand-written like 0142-0146 — the snapshot chain is broken from 0135 onward.
-- ================================================================================================

ALTER TABLE "whatsapp_dispatches"
  DROP CONSTRAINT IF EXISTS "whatsapp_dispatches_status_chk";--> statement-breakpoint
ALTER TABLE "whatsapp_dispatches"
  ADD CONSTRAINT "whatsapp_dispatches_status_chk"
  CHECK ("status" in ('pending', 'sending', 'completed', 'failed'));--> statement-breakpoint

-- Backfill the rows the old code left mislabelled. Keyed on `completed_at`, which was always written
-- correctly — it is the status that lied, so the timestamp is the trustworthy witness here.
UPDATE "whatsapp_dispatches"
SET status = 'completed', updated_at = now()
WHERE completed_at IS NOT NULL AND status = 'sending';--> statement-breakpoint

-- Find a stale lease quickly. Partial, because the sweeper only ever asks about unfinished rows.
CREATE INDEX IF NOT EXISTS "idx_whatsapp_dispatches_stale_lease"
  ON "whatsapp_dispatches" USING btree ("leased_at")
  WHERE completed_at IS NULL AND status = 'sending';
