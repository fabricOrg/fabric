CREATE TABLE "webhook_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"http_status" integer,
	"error_category" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_delivery_attempts_outcome_check" CHECK ("webhook_delivery_attempts"."outcome" IN ('delivered', 'retry', 'dead')),
	CONSTRAINT "webhook_delivery_attempts_number_check" CHECK ("webhook_delivery_attempts"."attempt_number" > 0),
	CONSTRAINT "webhook_delivery_attempts_http_status_check" CHECK ("webhook_delivery_attempts"."http_status" IS NULL OR ("webhook_delivery_attempts"."http_status" BETWEEN 100 AND 599))
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_webhook_delivery_attempt_number" ON "webhook_delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "idx_webhook_delivery_attempts_tenant_delivery" ON "webhook_delivery_attempts" USING btree ("tenant_id","delivery_id","completed_at");