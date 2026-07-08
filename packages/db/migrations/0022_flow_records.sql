CREATE TABLE "flow_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"customer" text NOT NULL,
	"channel" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"otp_hash" text,
	"verify_status" text DEFAULT 'pending' NOT NULL,
	"verification_id" text,
	"verify_at" timestamp with time zone,
	"charge_status" text DEFAULT 'pending' NOT NULL,
	"charge_at" timestamp with time zone,
	"charge_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notify_status" text DEFAULT 'pending' NOT NULL,
	"notify_message_id" text,
	"notify_at" timestamp with time zone,
	"audit_actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_records" ADD CONSTRAINT "flow_records_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_flow_corr" ON "flow_records" USING btree ("tenant_id","correlation_id");--> statement-breakpoint
CREATE INDEX "idx_flow_tenant_created" ON "flow_records" USING btree ("tenant_id","created_at");