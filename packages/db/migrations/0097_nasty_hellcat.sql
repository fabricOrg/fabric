CREATE TYPE "public"."sender_carrier_status" AS ENUM('unregistered', 'submitted', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "carrier_status" "sender_carrier_status" DEFAULT 'unregistered' NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "carrier_ref" text;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "carrier_decided_at" timestamp with time zone;--> statement-breakpoint
-- Backfill BEFORE the constraint: ADD CONSTRAINT validates existing rows, so every sender already
-- `active` (they all default to 'unregistered') would fail the migration outright.
--
-- Existing active senders are GRANDFATHERED as carrier-approved rather than demoted to pending.
-- Under the old flow `status = 'active'` was the only gate an operator had, and demoting would cut
-- off senders that are genuinely registered with the carrier and sending today. The assumption is
-- recorded in carrier_ref so it is auditable as an assumption, not mistaken later for a verified
-- registration — anything grandfathered here should be re-confirmed against the carrier.
UPDATE "senders"
   SET "carrier_status" = 'approved',
       "carrier_ref" = 'grandfathered:0097',
       "carrier_decided_at" = COALESCE("decided_at", now())
 WHERE "status" = 'active' AND "carrier_status" <> 'approved';--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "sender_active_requires_carrier_approval" CHECK ("senders"."status" <> 'active' OR "senders"."carrier_status" = 'approved');