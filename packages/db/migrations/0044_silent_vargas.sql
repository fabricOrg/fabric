ALTER TABLE "data_subjects" DROP CONSTRAINT "uniq_data_subject_tenant_phone";--> statement-breakpoint
ALTER TABLE "data_subjects" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_data_subject_tenant_phone_live" ON "data_subjects" USING btree ("tenant_id","phone_hash") WHERE erased_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_dek_keys_subject_status" ON "dek_keys" USING btree ("subject_id","status");--> statement-breakpoint
CREATE INDEX "idx_pii_vault_subject_kind" ON "pii_vault" USING btree ("subject_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "dek_keys" ADD CONSTRAINT "uniq_dek_subject" UNIQUE("subject_id");