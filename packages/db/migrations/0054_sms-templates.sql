CREATE TABLE "sms_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"message_class" text DEFAULT 'transactional' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_sms_templates_tenant_name" UNIQUE("tenant_id","name"),
	CONSTRAINT "sms_templates_message_class_check" CHECK ("sms_templates"."message_class" IN ('transactional', 'promotional'))
);
