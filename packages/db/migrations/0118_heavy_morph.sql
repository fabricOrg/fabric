CREATE TABLE "token_recognition_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"hold_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"consumed_before" bigint NOT NULL,
	"consumed_after" bigint NOT NULL,
	"recognized_before_minor" bigint NOT NULL,
	"recognized_after_minor" bigint NOT NULL,
	"recognition_minor" bigint NOT NULL,
	"ledger_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_token_recognition_hold" UNIQUE("hold_id"),
	CONSTRAINT "uniq_token_recognition_ledger_txn" UNIQUE("ledger_txn_id"),
	CONSTRAINT "token_recognition_quantity_chk" CHECK ("token_recognition_allocations"."quantity" > 0),
	CONSTRAINT "token_recognition_position_chk" CHECK ("token_recognition_allocations"."consumed_before" >= 0
        and "token_recognition_allocations"."consumed_after" = "token_recognition_allocations"."consumed_before" + "token_recognition_allocations"."quantity"
        and "token_recognition_allocations"."recognized_before_minor" >= 0
        and "token_recognition_allocations"."recognized_after_minor" = "token_recognition_allocations"."recognized_before_minor" + "token_recognition_allocations"."recognition_minor"
        and "token_recognition_allocations"."recognition_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "token_lots" DROP CONSTRAINT "token_lots_price_chk";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP CONSTRAINT "token_purchases_price_chk";--> statement-breakpoint
ALTER TABLE "token_purchases" DROP CONSTRAINT "token_purchases_amount_chk";--> statement-breakpoint
ALTER TABLE "token_lots" ALTER COLUMN "unit_price_minor_locked" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "token_purchases" ALTER COLUMN "unit_price_minor_locked" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "pricing_model" text DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "offer_version_id" uuid;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "compatibility_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "total_price_minor_locked" bigint;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "quantity_consumed" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "token_lots" ADD COLUMN "revenue_recognized_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD COLUMN "pricing_model" text DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD COLUMN "offer_version_id" uuid;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD COLUMN "pack_count" integer;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD COLUMN "units_per_pack_locked" bigint;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD COLUMN "price_per_pack_minor_locked" bigint;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD COLUMN "offer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" ADD CONSTRAINT "token_recognition_allocations_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" ADD CONSTRAINT "token_recognition_allocations_lot_id_token_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."token_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" ADD CONSTRAINT "token_recognition_allocations_hold_id_token_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."token_holds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" ADD CONSTRAINT "token_recognition_allocations_ledger_txn_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_txn_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_token_recognition_lot" ON "token_recognition_allocations" USING btree ("tenant_id","lot_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_token_recognition_reference" ON "token_recognition_allocations" USING btree ("tenant_id","reference_id");--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_offer_version_id_pricing_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."pricing_offer_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_offer_version_id_pricing_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."pricing_offer_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_pricing_model_chk" CHECK (("token_lots"."pricing_model" = 'unit'
          and "token_lots"."unit_price_minor_locked" > 0
          and "token_lots"."total_price_minor_locked" is null
          and "token_lots"."offer_version_id" is null
          and "token_lots"."compatibility_snapshot" is null)
        or ("token_lots"."pricing_model" = 'fixed_bundle'
          and "token_lots"."unit_price_minor_locked" is null
          and "token_lots"."total_price_minor_locked" > 0
          and "token_lots"."offer_version_id" is not null
          and "token_lots"."compatibility_snapshot" is not null));--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_allocation_position_chk" CHECK ("token_lots"."quantity_consumed" >= 0
        and "token_lots"."quantity_consumed" <= "token_lots"."quantity_total"
        and "token_lots"."revenue_recognized_minor" >= 0
        and (("token_lots"."pricing_model" = 'unit'
            and "token_lots"."revenue_recognized_minor" = "token_lots"."quantity_consumed" * "token_lots"."unit_price_minor_locked")
          or ("token_lots"."pricing_model" = 'fixed_bundle'
            and "token_lots"."revenue_recognized_minor" <= "token_lots"."total_price_minor_locked"
            and ("token_lots"."quantity_consumed" < "token_lots"."quantity_total"
              or "token_lots"."revenue_recognized_minor" = "token_lots"."total_price_minor_locked"))));--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_pricing_model_chk" CHECK ("token_purchases"."pricing_model" in ('unit', 'fixed_bundle'));--> statement-breakpoint
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
          and "token_purchases"."units_per_pack_locked" > 0
          and "token_purchases"."price_per_pack_minor_locked" > 0
          and "token_purchases"."offer_snapshot" is not null
          and "token_purchases"."quantity" = "token_purchases"."units_per_pack_locked" * "token_purchases"."pack_count"
          and "token_purchases"."amount_minor" = "token_purchases"."price_per_pack_minor_locked" * "token_purchases"."pack_count"));
--> statement-breakpoint
ALTER TABLE token_recognition_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE token_recognition_allocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON token_recognition_allocations FOR ALL TO app_runtime
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY provisioner_all ON token_recognition_allocations FOR ALL TO app_provisioner
  USING (true) WITH CHECK (true);
--> statement-breakpoint
REVOKE ALL ON token_recognition_allocations FROM PUBLIC, app_runtime, app_provisioner;
--> statement-breakpoint
GRANT SELECT, INSERT ON token_recognition_allocations TO app_runtime;
GRANT SELECT ON token_recognition_allocations TO app_provisioner;
--> statement-breakpoint
-- Entitlement lots are durable purchase history. The runtime may advance cumulative recognition,
-- but it must never delete the evidence that backs the counter and deferred-revenue balance.
REVOKE DELETE ON token_lots FROM app_runtime;
