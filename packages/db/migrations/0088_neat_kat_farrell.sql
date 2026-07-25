-- ADR-0010 Phase 2 (slice 2a). IF NOT EXISTS per repo convention (see 0086): an enum value is never
-- dropped, and a re-run must not fail. No statement below USES these new values, which is what makes
-- adding them safe inside the migration transaction.
ALTER TYPE "public"."ledger_account_kind" ADD VALUE IF NOT EXISTS 'token_deferred_revenue';--> statement-breakpoint
ALTER TYPE "public"."ledger_reason" ADD VALUE IF NOT EXISTS 'token_purchase' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."ledger_reason" ADD VALUE IF NOT EXISTS 'token_consume' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."ledger_reason" ADD VALUE IF NOT EXISTS 'token_breakage' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."ledger_txn_type" ADD VALUE IF NOT EXISTS 'token_purchase';--> statement-breakpoint
CREATE TABLE "token_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"currency" text NOT NULL,
	"available" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_token_counter" UNIQUE("tenant_id","channel","currency"),
	CONSTRAINT "token_counters_channel_chk" CHECK ("token_counters"."channel" in ('sms', 'email')),
	CONSTRAINT "token_counters_available_chk" CHECK ("token_counters"."available" >= 0)
);
--> statement-breakpoint
CREATE TABLE "token_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"currency" text NOT NULL,
	"quantity_total" bigint NOT NULL,
	"unit_price_minor_locked" bigint NOT NULL,
	"purchase_reference" text NOT NULL,
	"purchase_txn_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_token_lot_purchase" UNIQUE("tenant_id","purchase_reference"),
	CONSTRAINT "token_lots_channel_chk" CHECK ("token_lots"."channel" in ('sms', 'email')),
	CONSTRAINT "token_lots_quantity_chk" CHECK ("token_lots"."quantity_total" > 0),
	CONSTRAINT "token_lots_price_chk" CHECK ("token_lots"."unit_price_minor_locked" > 0)
);
--> statement-breakpoint
CREATE TABLE "token_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"provider" text DEFAULT 'paystack' NOT NULL,
	"provider_ref" text,
	"channel" text NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_price_minor_locked" bigint NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_purchases_reference_unique" UNIQUE("reference"),
	CONSTRAINT "token_purchases_channel_chk" CHECK ("token_purchases"."channel" in ('sms', 'email')),
	CONSTRAINT "token_purchases_status_chk" CHECK ("token_purchases"."status" in ('pending', 'success', 'failed')),
	CONSTRAINT "token_purchases_quantity_chk" CHECK ("token_purchases"."quantity" > 0),
	CONSTRAINT "token_purchases_price_chk" CHECK ("token_purchases"."unit_price_minor_locked" > 0),
	CONSTRAINT "token_purchases_amount_chk" CHECK ("token_purchases"."amount_minor" = "token_purchases"."quantity" * "token_purchases"."unit_price_minor_locked")
);
--> statement-breakpoint
ALTER TABLE "token_counters" ADD CONSTRAINT "token_counters_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_purchase_txn_id_ledger_transactions_id_fk" FOREIGN KEY ("purchase_txn_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_token_lots_tenant_channel" ON "token_lots" USING btree ("tenant_id","channel","currency");--> statement-breakpoint
CREATE INDEX "idx_token_purchases_tenant" ON "token_purchases" USING btree ("tenant_id","created_at");