CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"body_pii_id" uuid NOT NULL,
	"virtual_number" text NOT NULL,
	"keyword" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_subject_id_data_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."data_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_body_pii_id_pii_vault_id_fk" FOREIGN KEY ("body_pii_id") REFERENCES "public"."pii_vault"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inbound_messages_tenant_created" ON "inbound_messages" USING btree ("tenant_id","created_at");