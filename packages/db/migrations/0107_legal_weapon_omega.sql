DO $$ BEGIN
	ALTER TYPE "public"."plugin_capability" ADD VALUE 'email' BEFORE 'whatsapp';
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE "price_book_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"minimum_margin_bps" integer DEFAULT 2000 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"source_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_price_book_version" UNIQUE("price_book_id","version"),
	CONSTRAINT "price_book_versions_status_chk" CHECK ("price_book_versions"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "price_book_versions_margin_chk" CHECK ("price_book_versions"."minimum_margin_bps" between 0 and 10000),
	CONSTRAINT "price_book_versions_window_chk" CHECK ("price_book_versions"."effective_to" is null or "price_book_versions"."effective_to" > "price_book_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "pricing_sell_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"currency" char(3) NOT NULL,
	"unit_basis" text NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"destination_country" char(2),
	"traffic_class" text,
	"provider_vendor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_pricing_sell_rule" UNIQUE NULLS NOT DISTINCT("version_id","channel","currency","destination_country","traffic_class","provider_vendor"),
	CONSTRAINT "pricing_sell_rules_channel_chk" CHECK ("pricing_sell_rules"."channel" in ('sms', 'email')),
	CONSTRAINT "pricing_sell_rules_basis_chk" CHECK (("pricing_sell_rules"."channel" = 'sms' and "pricing_sell_rules"."unit_basis" = 'segment')
        or ("pricing_sell_rules"."channel" = 'email' and "pricing_sell_rules"."unit_basis" = 'recipient')),
	CONSTRAINT "pricing_sell_rules_class_chk" CHECK ("pricing_sell_rules"."traffic_class" is null or "pricing_sell_rules"."traffic_class" in ('promotional', 'transactional', 'otp')),
	CONSTRAINT "pricing_sell_rules_price_chk" CHECK ("pricing_sell_rules"."unit_price_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "provider_cost_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_vendor" text NOT NULL,
	"channel" text NOT NULL,
	"destination_country" char(2),
	"traffic_class" text,
	"currency" char(3) NOT NULL,
	"unit_basis" text NOT NULL,
	"numerator_minor" bigint NOT NULL,
	"denominator" bigint NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"source_reference" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_cost_rates_channel_chk" CHECK ("provider_cost_rates"."channel" in ('sms', 'email')),
	CONSTRAINT "provider_cost_rates_basis_chk" CHECK (("provider_cost_rates"."channel" = 'sms' and "provider_cost_rates"."unit_basis" = 'segment')
        or ("provider_cost_rates"."channel" = 'email' and "provider_cost_rates"."unit_basis" = 'recipient')),
	CONSTRAINT "provider_cost_rates_class_chk" CHECK ("provider_cost_rates"."traffic_class" is null or "provider_cost_rates"."traffic_class" in ('promotional', 'transactional', 'otp')),
	CONSTRAINT "provider_cost_rates_ratio_chk" CHECK ("provider_cost_rates"."numerator_minor" > 0 and "provider_cost_rates"."denominator" > 0),
	CONSTRAINT "provider_cost_rates_window_chk" CHECK ("provider_cost_rates"."effective_to" is null or "provider_cost_rates"."effective_to" > "provider_cost_rates"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "cost_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "currency" char(3) DEFAULT 'GHS' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "billing_currency" char(3) DEFAULT 'GHS' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_billing_currency_chk"
	CHECK ("billing_currency" IN ('GHS', 'NGN', 'USD'));--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "price_book_versions" ADD CONSTRAINT "price_book_versions_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_sell_rules" ADD CONSTRAINT "pricing_sell_rules_version_id_price_book_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."price_book_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_price_book_versions_effective" ON "price_book_versions" USING btree ("price_book_id","status","effective_from");--> statement-breakpoint
CREATE INDEX "idx_pricing_sell_rules_resolve" ON "pricing_sell_rules" USING btree ("version_id","channel","currency","destination_country");--> statement-breakpoint
CREATE INDEX "idx_provider_cost_rates_resolve" ON "provider_cost_rates" USING btree ("provider_vendor","channel","currency","destination_country","effective_from");--> statement-breakpoint
-- Preserve every existing book as immutable version 1. This keeps the effective-price resolver
-- backward compatible while staff migrate books to destination/provider-specific versions.
INSERT INTO "price_book_versions" (
	"price_book_id",
	"version",
	"status",
	"minimum_margin_bps",
	"effective_from",
	"source_snapshot"
)
SELECT
	pb."id",
	1,
	'published',
	2000,
	pb."created_at",
	jsonb_build_object('migration', 'legacy_price_book_rates')
FROM "price_books" pb
ON CONFLICT ("price_book_id", "version") DO NOTHING;--> statement-breakpoint

INSERT INTO "pricing_sell_rules" (
	"version_id",
	"channel",
	"currency",
	"unit_basis",
	"unit_price_minor",
	"created_at",
	"updated_at"
)
SELECT
	pbv."id",
	pbr."channel",
	pbr."currency",
	CASE WHEN pbr."channel" = 'sms' THEN 'segment' ELSE 'recipient' END,
	pbr."unit_price_minor",
	pbr."created_at",
	pbr."updated_at"
FROM "price_book_rates" pbr
JOIN "price_book_versions" pbv
	ON pbv."price_book_id" = pbr."price_book_id"
	AND pbv."version" = 1
ON CONFLICT (
	"version_id",
	"channel",
	"currency",
	"destination_country",
	"traffic_class",
	"provider_vendor"
) DO NOTHING;--> statement-breakpoint

-- Pricing is control-plane state. Only the provisioner may read or mutate it; the tenant runtime
-- reaches it through PricingService's bounded cache and never receives direct table privileges.
REVOKE ALL PRIVILEGES ON "price_book_versions", "pricing_sell_rules", "provider_cost_rates"
	FROM PUBLIC, app_runtime, app_provisioner;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
	ON "price_book_versions", "pricing_sell_rules", "provider_cost_rates"
	TO app_provisioner;
