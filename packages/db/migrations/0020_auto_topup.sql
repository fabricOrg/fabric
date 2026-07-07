CREATE TABLE "auto_topup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"threshold_minor" bigint NOT NULL,
	"top_up_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_topup_tenant_id_unique" UNIQUE("tenant_id")
);
