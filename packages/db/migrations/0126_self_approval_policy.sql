ALTER TABLE "pricing_offer_versions" DROP CONSTRAINT "pricing_offer_versions_approval_chk";--> statement-breakpoint
ALTER TABLE "pricing_offer_versions" ADD COLUMN "self_approval_reason" text;--> statement-breakpoint
ALTER TABLE "pricing_offer_versions" ADD CONSTRAINT "pricing_offer_versions_approval_chk" CHECK (("pricing_offer_versions"."status" = 'draft' and "pricing_offer_versions"."approved_by" is null and "pricing_offer_versions"."approved_at" is null)
        or ("pricing_offer_versions"."status" in ('published', 'retired') and "pricing_offer_versions"."approved_by" is not null
          and "pricing_offer_versions"."approved_at" is not null
          and ("pricing_offer_versions"."approved_by" <> "pricing_offer_versions"."created_by"
            or "pricing_offer_versions"."self_approval_reason" is not null)));