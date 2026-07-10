CREATE TYPE "public"."sender_status" AS ENUM('pending', 'active', 'rejected');--> statement-breakpoint
CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"country" text NOT NULL,
	"type" text DEFAULT 'alphanumeric' NOT NULL,
	"use_case" text NOT NULL,
	"status" "sender_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_sender_tenant_id_country" UNIQUE("tenant_id","sender_id","country")
);
