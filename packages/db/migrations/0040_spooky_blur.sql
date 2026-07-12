CREATE TABLE "virtual_deliveries" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_ciphertext" text NOT NULL,
	"body_ciphertext" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_mode" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual_deliveries" ADD CONSTRAINT "virtual_deliveries_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
UPDATE "messages" SET "delivery_mode" = 'virtual' WHERE "provider_slug" = 'fake-sms';
--> statement-breakpoint
ALTER TABLE "virtual_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "virtual_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "virtual_deliveries" FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "virtual_deliveries" TO app_runtime;
