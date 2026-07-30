CREATE TABLE "commercial_offer_channels" (
	"code" text NOT NULL,
	"unit_code" text NOT NULL,
	"display_name" text NOT NULL,
	"unit_label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_offer_channels_pk" PRIMARY KEY("code","unit_code"),
	CONSTRAINT "commercial_offer_channels_code_chk" CHECK ("commercial_offer_channels"."code" ~ '^[a-z][a-z0-9_]{1,31}$'),
	CONSTRAINT "commercial_offer_channels_unit_chk" CHECK ("commercial_offer_channels"."unit_code" ~ '^[a-z][a-z0-9_]{1,31}$')
);
--> statement-breakpoint
CREATE TABLE "pricing_offer_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" char(3) NOT NULL,
	"paid_units" bigint NOT NULL,
	"bonus_units" bigint DEFAULT 0 NOT NULL,
	"total_units" bigint NOT NULL,
	"total_price_minor" bigint NOT NULL,
	"minimum_pack_count" integer DEFAULT 1 NOT NULL,
	"maximum_pack_count" integer,
	"eligibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_snapshot" jsonb,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_pricing_offer_version" UNIQUE("offer_id","version"),
	CONSTRAINT "pricing_offer_versions_version_chk" CHECK ("pricing_offer_versions"."version" > 0),
	CONSTRAINT "pricing_offer_versions_status_chk" CHECK ("pricing_offer_versions"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "pricing_offer_versions_paid_units_chk" CHECK ("pricing_offer_versions"."paid_units" > 0),
	CONSTRAINT "pricing_offer_versions_bonus_units_chk" CHECK ("pricing_offer_versions"."bonus_units" >= 0),
	CONSTRAINT "pricing_offer_versions_total_units_chk" CHECK ("pricing_offer_versions"."total_units" = "pricing_offer_versions"."paid_units" + "pricing_offer_versions"."bonus_units"),
	CONSTRAINT "pricing_offer_versions_total_price_chk" CHECK ("pricing_offer_versions"."total_price_minor" > 0),
	CONSTRAINT "pricing_offer_versions_pack_range_chk" CHECK ("pricing_offer_versions"."minimum_pack_count" > 0 and
        ("pricing_offer_versions"."maximum_pack_count" is null or "pricing_offer_versions"."maximum_pack_count" >= "pricing_offer_versions"."minimum_pack_count")),
	CONSTRAINT "pricing_offer_versions_window_chk" CHECK ("pricing_offer_versions"."effective_to" is null or "pricing_offer_versions"."effective_to" > "pricing_offer_versions"."effective_from"),
	CONSTRAINT "pricing_offer_versions_eligibility_chk" CHECK (jsonb_typeof("pricing_offer_versions"."eligibility") = 'object'),
	CONSTRAINT "pricing_offer_versions_approval_chk" CHECK (("pricing_offer_versions"."status" = 'draft' and "pricing_offer_versions"."approved_by" is null and "pricing_offer_versions"."approved_at" is null)
        or ("pricing_offer_versions"."status" in ('published', 'retired') and "pricing_offer_versions"."approved_by" is not null
          and "pricing_offer_versions"."approved_at" is not null and "pricing_offer_versions"."approved_by" <> "pricing_offer_versions"."created_by")),
	CONSTRAINT "pricing_offer_versions_cost_snapshot_chk" CHECK ("pricing_offer_versions"."status" = 'draft' or "pricing_offer_versions"."cost_snapshot" is not null)
);
--> statement-breakpoint
CREATE TABLE "pricing_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"channel_code" text NOT NULL,
	"unit_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_pricing_offer_book_code" UNIQUE("price_book_id","code"),
	CONSTRAINT "pricing_offers_code_chk" CHECK ("pricing_offers"."code" ~ '^[a-z][a-z0-9_-]{1,63}$')
);
--> statement-breakpoint
ALTER TABLE "pricing_offer_versions" ADD CONSTRAINT "pricing_offer_versions_offer_id_pricing_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."pricing_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_offer_versions" ADD CONSTRAINT "pricing_offer_versions_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_offer_versions" ADD CONSTRAINT "pricing_offer_versions_approved_by_staff_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_offers" ADD CONSTRAINT "pricing_offers_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_offers" ADD CONSTRAINT "pricing_offers_channel_unit_fk" FOREIGN KEY ("channel_code","unit_code") REFERENCES "public"."commercial_offer_channels"("code","unit_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pricing_offer_versions_effective" ON "pricing_offer_versions" USING btree ("offer_id","status","currency","effective_from");--> statement-breakpoint
CREATE INDEX "idx_pricing_offers_catalog" ON "pricing_offers" USING btree ("price_book_id","channel_code","unit_code");--> statement-breakpoint

-- Only channels with a shipped natural-unit definition are active. Future channels are registered
-- through controlled configuration; the offer and accounting schema does not change.
INSERT INTO "commercial_offer_channels" (
	"code", "unit_code", "display_name", "unit_label", "is_active"
) VALUES
	('sms', 'segment', 'SMS', 'segment', true),
	('email', 'recipient', 'Email', 'recipient', true)
ON CONFLICT ("code", "unit_code") DO NOTHING;--> statement-breakpoint

-- Published terms are financial evidence. A retirement changes lifecycle only; every price,
-- quantity, eligibility, approval, and effective term remains exactly as purchased.
CREATE OR REPLACE FUNCTION protect_published_pricing_offer_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.status = 'retired' THEN
			RAISE EXCEPTION 'a pricing offer version cannot start retired';
		END IF;
		RETURN NEW;
	END IF;

	IF OLD.status = 'retired' THEN
		RAISE EXCEPTION 'retired pricing offer versions are immutable';
	END IF;

	IF OLD.status = 'draft' AND NEW.status = 'retired' THEN
		RAISE EXCEPTION 'a draft pricing offer version cannot be retired';
	END IF;

	IF OLD.status = 'published' THEN
		IF NEW.status = 'retired'
			AND (to_jsonb(NEW) - ARRAY['status', 'updated_at'])
				= (to_jsonb(OLD) - ARRAY['status', 'updated_at'])
		THEN
			RETURN NEW;
		END IF;
		RAISE EXCEPTION 'published pricing offer versions are immutable';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER protect_published_pricing_offer_version_trigger
BEFORE INSERT OR UPDATE ON "pricing_offer_versions"
FOR EACH ROW
EXECUTE FUNCTION protect_published_pricing_offer_version();--> statement-breakpoint

-- Commercial offers are control-plane state. Tenant runtime receives sanitized effective offers
-- through the API and never reads or mutates the underlying catalog directly.
REVOKE ALL PRIVILEGES ON
	"commercial_offer_channels", "pricing_offers", "pricing_offer_versions"
	FROM PUBLIC, app_runtime, app_provisioner;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
	"commercial_offer_channels", "pricing_offers", "pricing_offer_versions"
	TO app_provisioner;
