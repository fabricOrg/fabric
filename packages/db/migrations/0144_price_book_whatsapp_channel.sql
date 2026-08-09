-- ================================================================================================
-- PRICING — allow a price book to carry WhatsApp rates.
--
-- `pricing_sell_rules` and `provider_cost_rates` already admitted 'whatsapp' (their channel/unit-basis
-- CHECKs list it); `price_book_rates` did not. That asymmetry is why the default-book seed started
-- failing the moment WhatsApp got a compiled default rate, and it is also what the admin console would
-- have hit on the first attempt to save a WhatsApp rate.
--
-- Hand-written for the same reason as 0142/0143 — the snapshot chain is broken from 0135 onward.
-- ================================================================================================

ALTER TABLE "price_book_rates"
  DROP CONSTRAINT IF EXISTS "price_book_rates_channel_chk";--> statement-breakpoint
ALTER TABLE "price_book_rates"
  ADD CONSTRAINT "price_book_rates_channel_chk"
  CHECK ("channel" in ('sms', 'email', 'whatsapp'));
