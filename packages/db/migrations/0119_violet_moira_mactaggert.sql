ALTER TABLE "token_purchases" ADD COLUMN "provider_mode" text;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD COLUMN "plugin_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD COLUMN "credential_version" integer;