CREATE TABLE "payment_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'paystack' NOT NULL,
	"authorization_code" text NOT NULL,
	"card_type" text,
	"last4" text,
	"exp_month" text,
	"exp_year" text,
	"bank" text,
	"reusable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_authorizations_tenant_id_unique" UNIQUE("tenant_id")
);
