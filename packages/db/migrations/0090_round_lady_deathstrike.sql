CREATE TABLE "token_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"currency" text NOT NULL,
	"quantity" bigint NOT NULL,
	"reference_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_token_hold_idempotency" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "token_holds_status_chk" CHECK ("token_holds"."status" in ('pending', 'committed', 'returned')),
	CONSTRAINT "token_holds_channel_chk" CHECK ("token_holds"."channel" in ('sms', 'email')),
	CONSTRAINT "token_holds_quantity_chk" CHECK ("token_holds"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "token_holds" ADD CONSTRAINT "token_holds_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_holds" ADD CONSTRAINT "token_holds_lot_id_token_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."token_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_token_holds_reference" ON "token_holds" USING btree ("tenant_id","reference_id");--> statement-breakpoint
CREATE INDEX "idx_token_holds_pending" ON "token_holds" USING btree ("tenant_id","status","created_at");