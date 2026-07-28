ALTER TABLE "payments" ADD COLUMN "provider_mode" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "plugin_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "credential_version" integer;