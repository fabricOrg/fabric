CREATE TABLE "message_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"resource_version" integer DEFAULT 1 NOT NULL,
	"reference" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"currency" char(3) NOT NULL,
	"max_cost_minor" bigint,
	"total_cost_minor" bigint DEFAULT 0 NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"channel" text NOT NULL,
	"message_id" uuid,
	"status" text DEFAULT 'accepted' NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"error_code" text,
	"provider_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_delivery_application_containment_fk" FOREIGN KEY ("application_id","tenant_id") REFERENCES "public"."applications"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_delivery_environment_containment_fk" FOREIGN KEY ("environment_id","application_id","tenant_id") REFERENCES "public"."environments"("id","application_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_delivery_definition_containment_fk" FOREIGN KEY ("definition_id","tenant_id","application_id") REFERENCES "public"."message_definitions"("id","tenant_id","application_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_delivery_version_containment_fk" FOREIGN KEY ("version_id","tenant_id","definition_id") REFERENCES "public"."message_definition_versions"("id","tenant_id","definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempts_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_delivery_idempotency" ON "message_deliveries" USING btree ("tenant_id","application_id","environment_id","idempotency_key");--> statement-breakpoint
-- Hand-reordered: the composite containment FK below requires this unique index to exist first
-- (drizzle-kit emits FKs before the indexes they depend on).
CREATE UNIQUE INDEX "uniq_message_delivery_id_tenant_app_env" ON "message_deliveries" USING btree ("id","tenant_id","application_id","environment_id");--> statement-breakpoint
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempt_containment_fk" FOREIGN KEY ("delivery_id","tenant_id","application_id","environment_id") REFERENCES "public"."message_deliveries"("id","tenant_id","application_id","environment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_message_deliveries_tenant_created" ON "message_deliveries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_message_deliveries_retention" ON "message_deliveries" USING btree ("expires_at") WHERE legal_hold = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_delivery_attempt_ordinal" ON "message_delivery_attempts" USING btree ("delivery_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_delivery_attempt_message" ON "message_delivery_attempts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_message_delivery_attempts_delivery" ON "message_delivery_attempts" USING btree ("tenant_id","delivery_id");