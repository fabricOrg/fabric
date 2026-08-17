-- ================================================================================================
-- PROVIDER COST RATES — a cost that prices money must say where it came from.
--
-- `source_reference` arrived as `NOT NULL DEFAULT ''`. The default exists so the migration that
-- added the column could backfill existing rows without a value, which was reasonable then and has
-- two consequences now:
--
--   1. every insert that omits the field still writes an empty string, so the "required" input
--      contract (`providerCostRateInputSchema`, min(1)) is enforced only on the API path — anything
--      writing the table directly, including a seed or a fixture, bypasses it silently;
--   2. a provider cost is the number the send path multiplies against to decide what a message
--      costs US. A row with no source is a MONEY RECORD WITH NO AUDIT TRAIL: nobody can answer
--      "which rate card said 2.00 GHS per WhatsApp message, and when".
--
-- Found by response validation, not by a test — the read DTO inherited the write-side min(1) and
-- the list endpoint 500'd on real local data. Documented-but-unenforced, it was invisible.
--
-- THE BACKFILL DOES NOT INVENT PROVENANCE. Rows written before this constraint genuinely have no
-- recorded source, and guessing one would be worse than the gap — it would look like an audit trail
-- while being fiction. They are marked explicitly so the absence is greppable and can be corrected
-- by someone who knows where those numbers came from.
--
-- Breaking, pre-prod (CLAUDE.md §11): a caller that relied on omitting `source_reference` now fails.
-- That is the point.
-- ================================================================================================

-- 1. Mark rows that never carried a source. Deliberately a sentinel, not a plausible-looking value.
UPDATE provider_cost_rates
   SET source_reference = 'UNRECORDED — predates 0151, provenance unknown'
 WHERE btrim(coalesce(source_reference, '')) = '';

-- 2. Remove the default, so an insert can no longer omit the field and get an empty string.
ALTER TABLE provider_cost_rates
  ALTER COLUMN source_reference DROP DEFAULT;

-- 3. Enforce it in the DATABASE, not only in the zod contract. The contract guards the API path;
--    this guards every path, which is the whole reason the hole existed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'provider_cost_rates_source_reference_present'
  ) THEN
    ALTER TABLE provider_cost_rates
      ADD CONSTRAINT provider_cost_rates_source_reference_present
      CHECK (btrim(source_reference) <> '');
  END IF;
END $$;
