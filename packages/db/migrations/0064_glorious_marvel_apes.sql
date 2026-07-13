CREATE TABLE "message_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"client_reference" text NOT NULL,
	"message_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_message_batch_item_reference" UNIQUE("batch_id","client_reference")
);
--> statement-breakpoint
CREATE TABLE "message_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"total_count" integer NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_message_batch_environment_key" UNIQUE("tenant_id","environment_id","idempotency_key"),
	CONSTRAINT "uniq_message_batch_id_tenant" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "message_batch_items" ADD CONSTRAINT "message_batch_items_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batch_items" ADD CONSTRAINT "message_batch_items_batch_id_message_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."message_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batch_items" ADD CONSTRAINT "message_batch_items_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batch_items" ADD CONSTRAINT "message_batch_items_batch_tenant_fk" FOREIGN KEY ("batch_id","tenant_id") REFERENCES "public"."message_batches"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batch_items" ADD CONSTRAINT "message_batch_items_message_tenant_fk" FOREIGN KEY ("message_id","tenant_id") REFERENCES "public"."messages"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batches" ADD CONSTRAINT "message_batches_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batches" ADD CONSTRAINT "message_batches_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batches" ADD CONSTRAINT "message_batches_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batches" ADD CONSTRAINT "message_batches_application_tenant_fk" FOREIGN KEY ("application_id","tenant_id") REFERENCES "public"."applications"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batches" ADD CONSTRAINT "message_batches_environment_application_tenant_fk" FOREIGN KEY ("environment_id","application_id","tenant_id") REFERENCES "public"."environments"("id","application_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_message_batch_items_batch" ON "message_batch_items" USING btree ("batch_id","id");