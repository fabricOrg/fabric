ALTER TABLE "virtual_deliveries" ALTER COLUMN "recipient_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual_deliveries" ALTER COLUMN "body_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "data_subjects" ADD COLUMN "phone_hash" text;--> statement-breakpoint
ALTER TABLE "virtual_deliveries" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "virtual_deliveries" ADD COLUMN "body_pii_id" uuid;--> statement-breakpoint
ALTER TABLE "virtual_deliveries" ADD CONSTRAINT "virtual_deliveries_subject_id_data_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."data_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_deliveries" ADD CONSTRAINT "virtual_deliveries_body_pii_id_pii_vault_id_fk" FOREIGN KEY ("body_pii_id") REFERENCES "public"."pii_vault"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subjects" ADD CONSTRAINT "uniq_data_subject_tenant_phone" UNIQUE("tenant_id","phone_hash");