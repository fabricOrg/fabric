CREATE TABLE "sandbox_usage_buckets" (
	"tenant_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"channel" text NOT NULL,
	"used_units" bigint NOT NULL,
	"daily_limit" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_usage_buckets_pk" PRIMARY KEY("tenant_id","usage_date","channel"),
	CONSTRAINT "sandbox_usage_buckets_channel_chk" CHECK ("sandbox_usage_buckets"."channel" in ('sms', 'email')),
	CONSTRAINT "sandbox_usage_buckets_used_chk" CHECK ("sandbox_usage_buckets"."used_units" >= 0),
	CONSTRAINT "sandbox_usage_buckets_limit_chk" CHECK ("sandbox_usage_buckets"."daily_limit" > 0),
	CONSTRAINT "sandbox_usage_buckets_ceiling_chk" CHECK ("sandbox_usage_buckets"."used_units" <= "sandbox_usage_buckets"."daily_limit")
);
--> statement-breakpoint
CREATE TABLE "sandbox_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid,
	"environment_id" uuid,
	"usage_date" date NOT NULL,
	"channel" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_sandbox_usage_reference" UNIQUE("tenant_id","channel","reference_id"),
	CONSTRAINT "sandbox_usage_events_channel_chk" CHECK ("sandbox_usage_events"."channel" in ('sms', 'email')),
	CONSTRAINT "sandbox_usage_events_units_chk" CHECK ("sandbox_usage_events"."units" > 0),
	CONSTRAINT "sandbox_usage_events_context_chk" CHECK (("sandbox_usage_events"."application_id" IS NULL AND "sandbox_usage_events"."environment_id" IS NULL)
        OR ("sandbox_usage_events"."application_id" IS NOT NULL AND "sandbox_usage_events"."environment_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_backing_chk";--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "backing" text DEFAULT 'wallet' NOT NULL;--> statement-breakpoint
ALTER TABLE "sandbox_usage_buckets" ADD CONSTRAINT "sandbox_usage_buckets_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_application_tenant_fk" FOREIGN KEY ("application_id","tenant_id") REFERENCES "public"."applications"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_environment_application_tenant_fk" FOREIGN KEY ("environment_id","application_id","tenant_id") REFERENCES "public"."environments"("id","application_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sandbox_usage_events_tenant_day" ON "sandbox_usage_events" USING btree ("tenant_id","usage_date","channel");--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_backing_chk" CHECK ("email_messages"."backing" in ('wallet', 'sandbox_allowance'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_backing_chk" CHECK ("messages"."backing" in ('wallet', 'tokens', 'sandbox_allowance'));