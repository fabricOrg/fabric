CREATE TABLE "message_dispatches" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "environment_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "body_pii_id" uuid;--> statement-breakpoint
ALTER TABLE "message_dispatches" ADD CONSTRAINT "message_dispatches_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_dispatches" ADD CONSTRAINT "message_dispatches_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_message_dispatches_pending" ON "message_dispatches" USING btree ("available_at","message_id") WHERE completed_at IS NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_pii_id_pii_vault_id_fk" FOREIGN KEY ("body_pii_id") REFERENCES "public"."pii_vault"("id") ON DELETE set null ON UPDATE no action;