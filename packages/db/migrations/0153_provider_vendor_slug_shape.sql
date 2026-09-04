-- `provider_cost_rates.provider_vendor` must be an ADAPTER SLUG (meta-cloud, arkesel-sms,
-- aws-ses-email), never a human label. Two things go wrong when it is not, and both are silent:
--
--   1. Pricing lookup matches the slug exactly, so a labelled row prices NOTHING while showing as
--      configured — the operator sees a rate and the send finds no safe effective price.
--   2. The value is republished in `route_vocabulary` by GET /internal/admin/commercial-offers,
--      whose contract constrains it to `^[a-zA-Z0-9._:-]+$`. A label containing a space therefore
--      fails response validation and 500s the whole staff pricing page.
--
-- Testing is carrying exactly that today: provider_vendor = 'testing whatsapp prcing'.
--
-- Added NOT VALID deliberately. It enforces the shape on every INSERT and UPDATE from now on, which
-- is the door that needs closing, while leaving existing rows untouched so this migration cannot
-- fail a deploy or destroy someone's data as a side effect. Clean the offending rows, then run
--   ALTER TABLE provider_cost_rates VALIDATE CONSTRAINT provider_cost_rates_vendor_slug_chk;
-- to close it retroactively.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_cost_rates_vendor_slug_chk'
      AND conrelid = 'provider_cost_rates'::regclass
  ) THEN
    ALTER TABLE provider_cost_rates
      ADD CONSTRAINT provider_cost_rates_vendor_slug_chk
      CHECK (provider_vendor ~ '^[a-zA-Z0-9._:-]+$') NOT VALID;
  END IF;
END $$;
