-- Retroactively close the vendor-slug constraint that 0153 added as NOT VALID.
--
-- 0153 deliberately did not validate: testing was carrying 'testing whatsapp prcing', and a
-- migration that fails a deploy — or silently deletes someone's pricing row — is worse than one
-- that closes the door on new writes and says so. That row has since been removed, so the check can
-- now cover the existing rows too.
--
-- Conditional on purpose. VALIDATE re-scans the table and raises if ANY row still violates, which
-- would fail the deploy for an environment that never got cleaned. That environment's staff pricing
-- page is already broken and its operator needs to fix the data, not have a deploy blocked behind
-- it — so validate where it is safe, leave it NOT VALID where it is not, and let `db:assert` report
-- the difference rather than a failed release.
DO $$
DECLARE
  invalid_rows bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_cost_rates_vendor_slug_chk'
      AND conrelid = 'provider_cost_rates'::regclass
  ) THEN
    RAISE NOTICE 'provider_cost_rates_vendor_slug_chk absent; 0153 has not run here.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_cost_rates_vendor_slug_chk'
      AND conrelid = 'provider_cost_rates'::regclass
      AND convalidated
  ) THEN
    RETURN; -- already validated; this migration is idempotent
  END IF;

  SELECT count(*) INTO invalid_rows
  FROM provider_cost_rates
  WHERE provider_vendor !~ '^[a-zA-Z0-9._:-]+$';

  IF invalid_rows > 0 THEN
    RAISE WARNING
      'provider_cost_rates still has % row(s) whose provider_vendor is not an adapter slug; leaving the constraint NOT VALID. Clean them, then ALTER TABLE provider_cost_rates VALIDATE CONSTRAINT provider_cost_rates_vendor_slug_chk;',
      invalid_rows;
    RETURN;
  END IF;

  ALTER TABLE provider_cost_rates
    VALIDATE CONSTRAINT provider_cost_rates_vendor_slug_chk;
END $$;
