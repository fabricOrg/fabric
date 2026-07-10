CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"msisdn_hash" text NOT NULL,
	"msisdn_masked" text NOT NULL,
	"channel" text DEFAULT 'sms' NOT NULL,
	"code_hash" text NOT NULL,
	"code_salt" text NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"message_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_verifications_tenant_msisdn" ON "verifications" USING btree ("tenant_id","msisdn_hash","created_at");