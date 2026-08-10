-- ================================================================================================
-- SMS DISPATCH — a lease column, so a claimed dispatch can be recovered instead of double-sent.
--
-- The defect this closes is the one fixed for WhatsApp in d341789, and it was written down there as
-- still open here: `loadStoredDispatch` merely SELECTs (no lock, no state transition), the provider is
-- then called, and only afterwards is completion recorded. The first database lock lands AFTER the
-- send. Two workers on one Redis queue — two API instances sharing REDIS_QUEUE_URL, or a retry racing
-- the original — both read a non-terminal row and both call the carrier. Two real SMS, two charges.
--
-- `message_dispatches` already had `status` and `attempts` but no `leased_at`, so there was nothing to
-- claim WITH: a claim without an expiry converts a worker crash into a permanent orphan whose wallet
-- reserve is never committed and never refunded (the failure 0147 fixed for WhatsApp).
--
-- NO status CHECK is added here, deliberately. WhatsApp's table carried one from the start so 0147
-- could widen it; adding a NEW constraint to this table would validate against production rows this
-- migration cannot inspect, risking a failed pre-deploy migration for no safety the lease does not
-- already provide. The legal values are enforced where they are written.
--
-- Hand-written like 0142-0147 — the snapshot chain is broken from 0135 onward.
-- ================================================================================================

ALTER TABLE "message_dispatches"
  ADD COLUMN IF NOT EXISTS "leased_at" timestamptz;--> statement-breakpoint

-- Finds a stale lease cheaply. Partial, because the only question ever asked of it is "which
-- unfinished dispatches has nobody touched recently".
CREATE INDEX IF NOT EXISTS "idx_message_dispatches_stale_lease"
  ON "message_dispatches" USING btree ("leased_at")
  WHERE completed_at IS NULL AND status = 'sending';
