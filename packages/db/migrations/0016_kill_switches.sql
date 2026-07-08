CREATE TABLE "kill_switches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"scope" text DEFAULT 'platform' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_reason" text,
	"last_actor_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kill_switches_key_unique" UNIQUE("key")
);
