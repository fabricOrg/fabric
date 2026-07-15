ALTER TYPE "public"."pii_kind" ADD VALUE IF NOT EXISTS 'email' BEFORE 'body';--> statement-breakpoint
ALTER TABLE "data_subjects" ADD COLUMN "email_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_data_subject_tenant_email_live" ON "data_subjects" USING btree ("tenant_id","email_hash") WHERE erased_at IS NULL AND email_hash IS NOT NULL;
