CREATE TYPE "public"."message_encoding" AS ENUM('gsm7', 'ucs2');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sending', 'accepted', 'sent', 'delivered', 'undelivered', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid,
	"sender_id" text NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"status_rank" integer DEFAULT 0 NOT NULL,
	"encoding" "message_encoding" NOT NULL,
	"segments" integer NOT NULL,
	"cost_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"provider_slug" text,
	"provider_ref" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_messages_tenant_created" ON "messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_messages_provider_ref" ON "messages" USING btree ("provider_slug","provider_ref") WHERE provider_ref IS NOT NULL;