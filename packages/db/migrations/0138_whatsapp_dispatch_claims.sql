ALTER TABLE "whatsapp_dispatches"
  ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_dispatches"
  ADD COLUMN IF NOT EXISTS "leased_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "whatsapp_dispatches" ADD CONSTRAINT "whatsapp_dispatches_status_chk"
    CHECK ("whatsapp_dispatches"."status" in ('pending', 'sending', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_whatsapp_dispatches_pending";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whatsapp_dispatches_pending" ON "whatsapp_dispatches" USING btree ("available_at","message_id") WHERE completed_at IS NULL AND status = 'pending';
