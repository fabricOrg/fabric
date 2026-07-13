CREATE TABLE "email_dispatches" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"content_pii_id" uuid,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"status_rank" integer DEFAULT 0 NOT NULL,
	"provider_slug" text DEFAULT 'sandbox-email' NOT NULL,
	"provider_ref" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_dispatches" ADD CONSTRAINT "email_dispatches_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_dispatches" ADD CONSTRAINT "email_dispatches_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_subject_id_data_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."data_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_content_pii_id_pii_vault_id_fk" FOREIGN KEY ("content_pii_id") REFERENCES "public"."pii_vault"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_application_tenant_fk" FOREIGN KEY ("application_id","tenant_id") REFERENCES "public"."applications"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_environment_application_tenant_fk" FOREIGN KEY ("environment_id","application_id","tenant_id") REFERENCES "public"."environments"("id","application_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_dispatches_pending" ON "email_dispatches" USING btree ("available_at","message_id") WHERE completed_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_email_messages_environment_created" ON "email_messages" USING btree ("tenant_id","environment_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_email_messages_provider_ref" ON "email_messages" USING btree ("provider_slug","provider_ref") WHERE provider_ref IS NOT NULL;