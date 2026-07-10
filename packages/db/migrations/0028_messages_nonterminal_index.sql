-- ================================================================================================
-- SWEEPER DISCOVERY INDEX — partial index for the maintenance job's stuck-reservation scan
-- ("which tenants have messages still non-terminal past the TTL?", every 5 minutes).
--
-- Partial on the four NON-terminal statuses: healthy messages pass through them in seconds, so the
-- index stays near-empty regardless of total messages volume — the 5-minute scan never degrades to
-- a full-table seq scan as history grows. Terminal rows (delivered/undelivered/failed/expired)
-- never re-enter the sweeper's view and stay out of the index entirely.
-- ================================================================================================

CREATE INDEX IF NOT EXISTS idx_messages_nonterminal_updated
  ON messages USING btree (updated_at)
  WHERE status IN ('queued', 'sending', 'accepted', 'sent');
