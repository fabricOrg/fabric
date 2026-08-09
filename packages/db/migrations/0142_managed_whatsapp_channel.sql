-- ================================================================================================
-- MANAGED MESSAGING — WhatsApp as a third channel.
--
-- Hand-written rather than generated: the snapshot chain is broken from 0135 onward (0135/0136 share
-- an id, and 0137-0141 have no snapshots at all), so `drizzle-kit generate` errors. Repairing that is
-- tracked separately; compounding it here would make the repair harder.
--
-- A CHECK cannot be widened in place, so each is dropped and recreated. `IF EXISTS` / `IF NOT EXISTS`
-- throughout because this file gets re-read.
-- ================================================================================================

ALTER TABLE "message_deliveries"
  DROP CONSTRAINT IF EXISTS "message_delivery_channel_check";--> statement-breakpoint
ALTER TABLE "message_deliveries"
  ADD CONSTRAINT "message_delivery_channel_check"
  CHECK ("channel" in ('sms', 'email', 'whatsapp'));--> statement-breakpoint

ALTER TABLE "message_delivery_attempts"
  ADD COLUMN IF NOT EXISTS "whatsapp_message_id" uuid;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "message_delivery_attempts"
    ADD CONSTRAINT "message_delivery_attempts_whatsapp_message_id_whatsapp_messages_id_fk"
    FOREIGN KEY ("whatsapp_message_id") REFERENCES "public"."whatsapp_messages"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_message_delivery_attempt_whatsapp_message"
  ON "message_delivery_attempts" USING btree ("whatsapp_message_id");--> statement-breakpoint

ALTER TABLE "message_delivery_attempts"
  DROP CONSTRAINT IF EXISTS "message_delivery_attempt_channel_check";--> statement-breakpoint
ALTER TABLE "message_delivery_attempts"
  ADD CONSTRAINT "message_delivery_attempt_channel_check"
  CHECK ("channel" in ('sms', 'email', 'whatsapp'));--> statement-breakpoint

-- The XOR. Each arm states BOTH halves — the reference that must be present AND the two that must be
-- NULL. Without the IS NULL clauses a row could carry two references and still satisfy the constraint,
-- and the attempt would then read as either channel depending which column the reader happened to
-- consult. Existing sms/email rows already satisfy this, since their other arms have always been NULL.
ALTER TABLE "message_delivery_attempts"
  DROP CONSTRAINT IF EXISTS "message_delivery_attempt_channel_message_check";--> statement-breakpoint
ALTER TABLE "message_delivery_attempts"
  ADD CONSTRAINT "message_delivery_attempt_channel_message_check"
  CHECK (
    ("channel" = 'sms' AND "message_id" IS NOT NULL AND "email_message_id" IS NULL AND "whatsapp_message_id" IS NULL)
    OR ("channel" = 'email' AND "email_message_id" IS NOT NULL AND "message_id" IS NULL AND "whatsapp_message_id" IS NULL)
    OR ("channel" = 'whatsapp' AND "whatsapp_message_id" IS NOT NULL AND "message_id" IS NULL AND "email_message_id" IS NULL)
  );
