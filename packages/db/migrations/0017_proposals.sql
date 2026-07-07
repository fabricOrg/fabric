CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"tenant_id" uuid,
	"tenant_label" text NOT NULL,
	"before_value" text NOT NULL,
	"after_value" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"maker_staff_id" uuid,
	"maker_email" text NOT NULL,
	"checker_staff_id" uuid,
	"checker_email" text,
	"decided_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
