-- Refuse rather than destroy. Dropping the unit-priced model is only safe where no such row
-- exists; a token lot is tied to ledger entries, so silently deleting one would orphan the postings
-- and break the token subledger's reconciliation to its control account. Verified empty on testing
-- before this shipped — this block is what protects every other database.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM token_lots
    WHERE pricing_model <> 'fixed_bundle' OR total_price_minor_locked IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy unit-priced token lots exist; reconcile them before dropping the unit pricing model';
  END IF;
  IF EXISTS (SELECT 1 FROM token_purchases WHERE pricing_model <> 'fixed_bundle') THEN
    RAISE EXCEPTION 'legacy unit-priced token purchases exist; reconcile them before dropping the unit pricing model';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "token_purchases" DROP CONSTRAINT "token_purchases_quantity_chk";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP CONSTRAINT "token_purchases_pricing_model_chk";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP CONSTRAINT "token_purchases_amount_chk";--> statement-breakpoint
ALTER TABLE "token_lots" DROP CONSTRAINT "token_lots_pricing_model_chk";--> statement-breakpoint
ALTER TABLE "token_lots" DROP CONSTRAINT "token_lots_allocation_position_chk";--> statement-breakpoint
ALTER TABLE "token_lots" ALTER COLUMN "total_price_minor_locked" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "token_purchases" DROP COLUMN "pricing_model";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP COLUMN "units_per_pack_locked";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP COLUMN "channel";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP COLUMN "quantity";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP COLUMN "unit_price_minor_locked";--> statement-breakpoint
ALTER TABLE "token_lots" DROP COLUMN "pricing_model";--> statement-breakpoint
ALTER TABLE "token_lots" DROP COLUMN "unit_price_minor_locked";--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_amount_chk" CHECK ("token_purchases"."offer_version_id" is not null
        and "token_purchases"."pack_count" > 0
        and "token_purchases"."price_per_pack_minor_locked" > 0
        and "token_purchases"."offer_snapshot" is not null
        and "token_purchases"."amount_minor" = "token_purchases"."price_per_pack_minor_locked" * "token_purchases"."pack_count");--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_offer_provenance_chk" CHECK ("token_lots"."total_price_minor_locked" > 0
        and "token_lots"."offer_version_id" is not null
        and "token_lots"."offer_version_item_id" is not null
        and "token_lots"."compatibility_snapshot" is not null);--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_allocation_position_chk" CHECK ("token_lots"."quantity_consumed" >= 0
        and "token_lots"."quantity_expired" >= 0
        and "token_lots"."quantity_consumed" + "token_lots"."quantity_expired" <= "token_lots"."quantity_total"
        and "token_lots"."revenue_recognized_minor" >= 0
        and "token_lots"."breakage_recognized_minor" >= 0
        and "token_lots"."revenue_recognized_minor" + "token_lots"."breakage_recognized_minor" <= "token_lots"."total_price_minor_locked"
        and ("token_lots"."quantity_consumed" + "token_lots"."quantity_expired" < "token_lots"."quantity_total"
          or "token_lots"."revenue_recognized_minor" + "token_lots"."breakage_recognized_minor" = "token_lots"."total_price_minor_locked"));