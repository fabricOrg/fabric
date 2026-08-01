ALTER TYPE "public"."ledger_txn_type" ADD VALUE 'token_breakage';--> statement-breakpoint
ALTER TABLE "email_messages" DROP CONSTRAINT "email_messages_backing_chk";--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_backing_chk" CHECK ("email_messages"."backing" in ('wallet', 'tokens', 'sandbox_allowance'));--> statement-breakpoint
INSERT INTO commercial_offer_channels (code, unit_code, display_name, unit_label, is_active)
VALUES ('email', 'message', 'Email', 'message', true)
ON CONFLICT (code, unit_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    unit_label = EXCLUDED.unit_label,
    is_active = true;--> statement-breakpoint
UPDATE commercial_offer_channels
SET is_active = false
WHERE code = 'email' AND unit_code = 'recipient';--> statement-breakpoint
CREATE TABLE "pricing_offer_version_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"channel_code" text NOT NULL,
	"unit_code" text NOT NULL,
	"paid_units" bigint NOT NULL,
	"bonus_units" bigint DEFAULT 0 NOT NULL,
	"total_units" bigint NOT NULL,
	"eligibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allocated_price_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_pricing_offer_version_item_position" UNIQUE("offer_version_id","position"),
	CONSTRAINT "uniq_pricing_offer_version_item_channel" UNIQUE("offer_version_id","channel_code"),
	CONSTRAINT "pricing_offer_version_items_position_chk" CHECK ("pricing_offer_version_items"."position" >= 0),
	CONSTRAINT "pricing_offer_version_items_paid_units_chk" CHECK ("pricing_offer_version_items"."paid_units" > 0),
	CONSTRAINT "pricing_offer_version_items_bonus_units_chk" CHECK ("pricing_offer_version_items"."bonus_units" >= 0),
	CONSTRAINT "pricing_offer_version_items_total_units_chk" CHECK ("pricing_offer_version_items"."total_units" = "pricing_offer_version_items"."paid_units" + "pricing_offer_version_items"."bonus_units"),
	CONSTRAINT "pricing_offer_version_items_eligibility_chk" CHECK (jsonb_typeof("pricing_offer_version_items"."eligibility") = 'object'),
	CONSTRAINT "pricing_offer_version_items_allocation_chk" CHECK ("pricing_offer_version_items"."allocated_price_minor" is null or "pricing_offer_version_items"."allocated_price_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "token_lots" DROP CONSTRAINT "uniq_token_lot_purchase";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP CONSTRAINT "token_purchases_quantity_chk";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP CONSTRAINT "token_purchases_amount_chk";--> statement-breakpoint
ALTER TABLE "token_lots" DROP CONSTRAINT "token_lots_pricing_model_chk";--> statement-breakpoint
ALTER TABLE "token_lots" DROP CONSTRAINT "token_lots_allocation_position_chk";--> statement-breakpoint
DROP INDEX "idx_pricing_offers_catalog";--> statement-breakpoint
ALTER TABLE "pricing_offers" ALTER COLUMN "channel_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_offers" ALTER COLUMN "unit_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "token_purchases" ALTER COLUMN "channel" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "token_purchases" ALTER COLUMN "quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_offer_versions" ADD COLUMN "credit_validity_days" integer;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "offer_version_item_id" uuid;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "quantity_expired" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "breakage_recognized_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "expiry_processed_at" timestamp with time zone;--> statement-breakpoint

-- Expand/backfill: every historical single-channel version becomes a one-item package. Keeping the
-- old columns for one compatibility release makes this safe for an in-flight old API while all new
-- code reads the normalized item rows.
INSERT INTO "pricing_offer_version_items" (
	"offer_version_id", "position", "channel_code", "unit_code", "paid_units",
	"bonus_units", "total_units", "eligibility", "allocated_price_minor",
	"created_at", "updated_at"
)
SELECT v.id, 0, o.channel_code, o.unit_code, v.paid_units, v.bonus_units,
	v.total_units, v.eligibility, v.total_price_minor, v.created_at, v.updated_at
FROM pricing_offer_versions v
JOIN pricing_offers o ON o.id = v.offer_id
WHERE o.channel_code IS NOT NULL AND o.unit_code IS NOT NULL
ON CONFLICT (offer_version_id, position) DO NOTHING;--> statement-breakpoint

-- Snapshot the new package/item shape before tightening the fixed-bundle purchase constraint.
UPDATE token_purchases p
SET offer_snapshot = jsonb_build_object(
	'offerCode', p.offer_snapshot->>'offerCode',
	'offerName', p.offer_snapshot->>'offerName',
	'offerVersion', (p.offer_snapshot->>'offerVersion')::int,
	'totalPriceMinor', p.offer_snapshot->>'totalPriceMinor',
	'creditValidityDays', NULL,
	'items', jsonb_build_array(jsonb_build_object(
		'itemId', i.id,
		'channelCode', p.offer_snapshot->>'channelCode',
		'unitCode', p.offer_snapshot->>'unitCode',
		'paidUnits', p.offer_snapshot->>'paidUnits',
		'bonusUnits', p.offer_snapshot->>'bonusUnits',
		'totalUnits', p.offer_snapshot->>'totalUnits',
		'allocatedPriceMinor', p.offer_snapshot->>'totalPriceMinor',
		'eligibility', COALESCE(p.offer_snapshot->'eligibility', '{}'::jsonb)
	))
)
FROM pricing_offer_version_items i
WHERE p.pricing_model = 'fixed_bundle'
	AND i.offer_version_id = p.offer_version_id;--> statement-breakpoint

UPDATE token_lots l
SET offer_version_item_id = i.id,
	compatibility_snapshot = jsonb_build_object(
		'itemId', i.id,
		'channelCode', l.compatibility_snapshot->>'channelCode',
		'unitCode', l.compatibility_snapshot->>'unitCode',
		'paidUnits', l.compatibility_snapshot->>'paidUnits',
		'bonusUnits', l.compatibility_snapshot->>'bonusUnits',
		'totalUnits', l.compatibility_snapshot->>'totalUnits',
		-- PER-PACK, matching what grantTokensForPurchase writes for new lots. The column
		-- total_price_minor_locked is the pack-multiplied total, so using it here would make the
		-- backfilled population disagree with the new one by a factor of pack_count.
		'allocatedPriceMinor', l.compatibility_snapshot->>'totalPriceMinor',
		'eligibility', COALESCE(l.compatibility_snapshot->'eligibility', '{}'::jsonb)
	)
FROM pricing_offer_version_items i
WHERE l.pricing_model = 'fixed_bundle'
	AND i.offer_version_id = l.offer_version_id;--> statement-breakpoint

UPDATE token_purchases
SET channel = NULL, quantity = NULL, units_per_pack_locked = NULL
WHERE pricing_model = 'fixed_bundle';--> statement-breakpoint
ALTER TABLE "pricing_offer_version_items" ADD CONSTRAINT "pricing_offer_version_items_offer_version_id_pricing_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."pricing_offer_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_offer_version_items" ADD CONSTRAINT "pricing_offer_version_items_channel_unit_fk" FOREIGN KEY ("channel_code","unit_code") REFERENCES "public"."commercial_offer_channels"("code","unit_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pricing_offer_version_items_channel" ON "pricing_offer_version_items" USING btree ("offer_version_id","channel_code","unit_code");--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_offer_version_item_id_pricing_offer_version_items_id_fk" FOREIGN KEY ("offer_version_item_id") REFERENCES "public"."pricing_offer_version_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pricing_offers_catalog" ON "pricing_offers" USING btree ("price_book_id");--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "uniq_token_lot_purchase_channel" UNIQUE("tenant_id","purchase_reference","channel");--> statement-breakpoint
ALTER TABLE "pricing_offer_versions" ADD CONSTRAINT "pricing_offer_versions_validity_chk" CHECK ("pricing_offer_versions"."credit_validity_days" is null or "pricing_offer_versions"."credit_validity_days" > 0);--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_quantity_chk" CHECK ("token_purchases"."quantity" is null or "token_purchases"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_amount_chk" CHECK (("token_purchases"."pricing_model" = 'unit'
          and "token_purchases"."unit_price_minor_locked" > 0
          and "token_purchases"."offer_version_id" is null
          and "token_purchases"."pack_count" is null
          and "token_purchases"."units_per_pack_locked" is null
          and "token_purchases"."price_per_pack_minor_locked" is null
          and "token_purchases"."offer_snapshot" is null
          and "token_purchases"."amount_minor" = "token_purchases"."quantity" * "token_purchases"."unit_price_minor_locked")
        or ("token_purchases"."pricing_model" = 'fixed_bundle'
          and "token_purchases"."unit_price_minor_locked" is null
          and "token_purchases"."offer_version_id" is not null
          and "token_purchases"."pack_count" > 0
          and "token_purchases"."channel" is null
          and "token_purchases"."quantity" is null
          and "token_purchases"."units_per_pack_locked" is null
          and "token_purchases"."price_per_pack_minor_locked" > 0
          and "token_purchases"."offer_snapshot" is not null
          and "token_purchases"."amount_minor" = "token_purchases"."price_per_pack_minor_locked" * "token_purchases"."pack_count"));--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_expiry_state_chk" CHECK (("token_lots"."expires_at" is null and "token_lots"."expiry_processed_at" is null and "token_lots"."quantity_expired" = 0 and "token_lots"."breakage_recognized_minor" = 0)
        or ("token_lots"."expires_at" is not null and ("token_lots"."expiry_processed_at" is null
          or ("token_lots"."expiry_processed_at" >= "token_lots"."expires_at"
            and "token_lots"."quantity_consumed" + "token_lots"."quantity_expired" = "token_lots"."quantity_total"))));--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_pricing_model_chk" CHECK (("token_lots"."pricing_model" = 'unit'
          and "token_lots"."unit_price_minor_locked" > 0
          and "token_lots"."total_price_minor_locked" is null
          and "token_lots"."offer_version_id" is null
          and "token_lots"."offer_version_item_id" is null
          and "token_lots"."compatibility_snapshot" is null)
        or ("token_lots"."pricing_model" = 'fixed_bundle'
          and "token_lots"."unit_price_minor_locked" is null
          and "token_lots"."total_price_minor_locked" > 0
          and "token_lots"."offer_version_id" is not null
          and "token_lots"."offer_version_item_id" is not null
          and "token_lots"."compatibility_snapshot" is not null));--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_allocation_position_chk" CHECK ("token_lots"."quantity_consumed" >= 0
        and "token_lots"."quantity_expired" >= 0
        and "token_lots"."quantity_consumed" + "token_lots"."quantity_expired" <= "token_lots"."quantity_total"
        and "token_lots"."revenue_recognized_minor" >= 0
        and "token_lots"."breakage_recognized_minor" >= 0
        and (("token_lots"."pricing_model" = 'unit'
            and "token_lots"."revenue_recognized_minor" = "token_lots"."quantity_consumed" * "token_lots"."unit_price_minor_locked"
            and "token_lots"."breakage_recognized_minor" = "token_lots"."quantity_expired" * "token_lots"."unit_price_minor_locked")
          or ("token_lots"."pricing_model" = 'fixed_bundle'
            and "token_lots"."revenue_recognized_minor" + "token_lots"."breakage_recognized_minor" <= "token_lots"."total_price_minor_locked"
            and ("token_lots"."quantity_consumed" + "token_lots"."quantity_expired" < "token_lots"."quantity_total"
              or "token_lots"."revenue_recognized_minor" + "token_lots"."breakage_recognized_minor" = "token_lots"."total_price_minor_locked"))));
--> statement-breakpoint

-- A published package's items are financial evidence just like its version row. Draft items remain
-- editable; once published/retired, neither quantity, channel, eligibility nor allocation can move.
--
-- DELETE is deliberately NOT guarded here, matching `protect_published_pricing_offer_version`, which
-- also fires only on INSERT OR UPDATE. Guarding it would make a published version unremovable by any
-- application role: the items FK is ON DELETE RESTRICT, so the version cannot go until its items do,
-- and published -> draft is itself refused. Removal therefore still costs the whole version, exactly
-- as it did before packages existed; what cannot happen is a channel being added to, or changed on,
-- an already-approved package.
CREATE OR REPLACE FUNCTION protect_published_pricing_offer_version_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	parent_status text;
BEGIN
	SELECT status INTO parent_status
	FROM pricing_offer_versions
	WHERE id = NEW.offer_version_id;
	IF parent_status <> 'draft' THEN
		RAISE EXCEPTION 'published pricing offer version items are immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER protect_published_pricing_offer_version_item_trigger
BEFORE INSERT OR UPDATE ON pricing_offer_version_items
FOR EACH ROW EXECUTE FUNCTION protect_published_pricing_offer_version_item();--> statement-breakpoint

REVOKE ALL PRIVILEGES ON pricing_offer_version_items
	FROM PUBLIC, app_runtime, app_provisioner;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON pricing_offer_version_items TO app_provisioner;
