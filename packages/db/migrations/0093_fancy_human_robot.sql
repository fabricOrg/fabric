-- ADR-0010 Phase 2 (slice 2c-i). Revenue recognition on token consumption gets its own txn type:
-- reporting groups on `type`, so labelling a consumption 'token_purchase' would misstate both the
-- cash-in and the earned-revenue sides. IF NOT EXISTS per repo convention (see 0086); no statement
-- here uses the new value, which is what makes the ADD VALUE safe inside the migration transaction.
ALTER TYPE "public"."ledger_txn_type" ADD VALUE IF NOT EXISTS 'token_consume';
