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
--
-- senders carries FORCE ROW LEVEL SECURITY (0036), which subjects even the table OWNER — the role
-- cloud-migrate runs as — to tenant_isolation. A migration sets no app.tenant_id, so the backfill
-- below matches ZERO rows while ADD CONSTRAINT still validates the whole table: the migration then
-- dies on 23514 against a row it believed it had just fixed. Local runs cannot catch this, because
-- the test harness migrates as a SUPERUSER, which bypasses RLS even under FORCE.
--
-- Lifting FORCE for the backfill is the narrow fix: this is a deliberately cross-tenant statement,
-- and the surrounding DDL already holds ACCESS EXCLUSIVE on the table inside the migration's single
-- transaction, so no other session can observe the gap.
ALTER TABLE "senders" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "senders"
   SET "carrier_status" = 'approved',
       "carrier_ref" = 'grandfathered:0097',
       "carrier_decided_at" = COALESCE("decided_at", now())
 WHERE "status" = 'active' AND "carrier_status" <> 'approved';--> statement-breakpoint
ALTER TABLE "senders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "sender_active_requires_carrier_approval" CHECK ("senders"."status" <> 'active' OR "senders"."carrier_status" = 'approved');