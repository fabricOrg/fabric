CREATE TYPE "public"."opt_out_scope" AS ENUM('promotional', 'all');--> statement-breakpoint
CREATE TYPE "public"."opt_out_source" AS ENUM('stop', 'registry', 'manual');--> statement-breakpoint
CREATE TABLE "opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"msisdn_hash" text NOT NULL,
	"msisdn_masked" text NOT NULL,
	"scope" "opt_out_scope" DEFAULT 'promotional' NOT NULL,
	"source" "opt_out_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_opt_out_tenant_msisdn" UNIQUE("tenant_id","msisdn_hash")
);
