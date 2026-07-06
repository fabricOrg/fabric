CREATE TYPE "public"."staff_role" AS ENUM('operator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"external_subject_id" text,
	"name" text,
	"role" "staff_role" DEFAULT 'operator' NOT NULL,
	"status" "staff_status" DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_email_unique" UNIQUE("email"),
	CONSTRAINT "staff_users_external_subject_id_unique" UNIQUE("external_subject_id")
);
