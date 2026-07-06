CREATE TYPE "public"."plugin_capability" AS ENUM('sms', 'whatsapp', 'payment', 'identity');--> statement-breakpoint
CREATE TYPE "public"."plugin_instance_status" AS ENUM('connected', 'available', 'error');--> statement-breakpoint
CREATE TYPE "public"."plugin_mode" AS ENUM('sandbox', 'live');--> statement-breakpoint
CREATE TABLE "plugin_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability" "plugin_capability" NOT NULL,
	"vendor" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"mode" "plugin_mode" DEFAULT 'sandbox' NOT NULL,
	"status" "plugin_instance_status" DEFAULT 'available' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"credentials_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_plugin_instance" UNIQUE("capability","vendor")
);
--> statement-breakpoint
CREATE INDEX "idx_plugin_instances_capability" ON "plugin_instances" USING btree ("capability");