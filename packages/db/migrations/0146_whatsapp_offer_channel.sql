-- ================================================================================================
-- COMMERCIAL OFFERS — register WhatsApp as a deliverable channel (ADR-0012 §2, ADR-0014 §3).
--
-- `commercial_offer_channels` is a governed registry, not an enum: adding a channel is a controlled
-- data change, and a (code, unit_code) pair is immutable once an offer references it. WhatsApp's unit
-- is `message`, matching how it is SOLD — one priced template message — rather than how Meta bills us
-- (per 24-hour conversation), which is the cost side and not a unit any caller can quote against.
--
-- Registering the channel is necessary and not sufficient: a registry entry is not cost evidence.
-- `resolveOfferCostBasis` still refuses to publish a WhatsApp offer until `provider_cost_rates` carries
-- rates that cover the routes its eligibility permits.
--
-- Hand-written like 0142-0145 — the snapshot chain is broken from 0135 onward.
-- ================================================================================================

INSERT INTO commercial_offer_channels (code, unit_code, display_name, unit_label, is_active)
VALUES ('whatsapp', 'message', 'WhatsApp', 'message', true)
ON CONFLICT (code, unit_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    unit_label = EXCLUDED.unit_label,
    is_active = true;
