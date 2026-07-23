ALTER TABLE "message_deliveries" DROP CONSTRAINT "message_delivery_channel_check";--> statement-breakpoint
ALTER TABLE "message_delivery_attempts" DROP CONSTRAINT "message_delivery_attempt_channel_check";--> statement-breakpoint
ALTER TABLE "message_definition_versions" ADD COLUMN "channel" text DEFAULT 'sms' NOT NULL;--> statement-breakpoint
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_delivery_channel_check" CHECK ("message_deliveries"."channel" in ('sms', 'email'));--> statement-breakpoint
ALTER TABLE "message_delivery_attempts" ADD CONSTRAINT "message_delivery_attempt_channel_check" CHECK ("message_delivery_attempts"."channel" in ('sms', 'email'));--> statement-breakpoint
ALTER TABLE "message_definition_versions" ADD CONSTRAINT "message_definition_version_channel_check" CHECK ("message_definition_versions"."channel" in ('sms', 'email'));