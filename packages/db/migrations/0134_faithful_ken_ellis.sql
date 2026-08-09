CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"content_pii_id" uuid,
	"template_name" text,
	"template_language" text,
	"template_category" text,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"status_rank" integer DEFAULT 0 NOT NULL,
	"backing" text DEFAULT 'wallet' NOT NULL,
	"provider_slug" text DEFAULT 'sandbox-whatsapp' NOT NULL,
	"provider_ref" text,
	"error_code" text,
	"cost_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"pricing_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_template_category_chk" CHECK ("whatsapp_messages"."template_category" IS NULL OR "whatsapp_messages"."template_category" in ('marketing', 'utility', 'authentication', 'service')),
	CONSTRAINT "whatsapp_messages_backing_chk" CHECK ("whatsapp_messages"."backing" in ('wallet', 'tokens', 'sandbox_allowance'))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_subject_id_data_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."data_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_content_pii_id_pii_vault_id_fk" FOREIGN KEY ("content_pii_id") REFERENCES "public"."pii_vault"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_application_tenant_fk" FOREIGN KEY ("application_id","tenant_id") REFERENCES "public"."applications"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_environment_application_tenant_fk" FOREIGN KEY ("environment_id","application_id","tenant_id") REFERENCES "public"."environments"("id","application_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_whatsapp_messages_environment_created" ON "whatsapp_messages" USING btree ("tenant_id","environment_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_whatsapp_messages_provider_ref" ON "whatsapp_messages" USING btree ("provider_slug","provider_ref") WHERE provider_ref IS NOT NULL;