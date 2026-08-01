ALTER TABLE "token_holds" DROP CONSTRAINT "token_holds_lot_id_token_lots_id_fk";
--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" DROP CONSTRAINT "token_recognition_allocations_lot_id_token_lots_id_fk";
--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" DROP CONSTRAINT "token_recognition_allocations_hold_id_token_holds_id_fk";
--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" DROP CONSTRAINT "token_recognition_allocations_ledger_txn_id_ledger_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "token_holds" ADD CONSTRAINT "uniq_token_hold_tenant_id" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "uniq_token_lot_tenant_id" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "uniq_ledger_txn_tenant_id" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "token_holds" ADD CONSTRAINT "token_holds_tenant_lot_fk" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "public"."token_lots"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" ADD CONSTRAINT "token_recognition_tenant_lot_fk" FOREIGN KEY ("tenant_id","lot_id") REFERENCES "public"."token_lots"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" ADD CONSTRAINT "token_recognition_tenant_hold_fk" FOREIGN KEY ("tenant_id","hold_id") REFERENCES "public"."token_holds"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_recognition_allocations" ADD CONSTRAINT "token_recognition_tenant_ledger_txn_fk" FOREIGN KEY ("tenant_id","ledger_txn_id") REFERENCES "public"."ledger_transactions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
