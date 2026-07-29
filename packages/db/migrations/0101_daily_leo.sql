ALTER TABLE "payments" ADD COLUMN "kind" text DEFAULT 'topup' NOT NULL;--> statement-breakpoint
UPDATE "payments" SET "kind" = 'collection' WHERE "reference" LIKE 'flow-%';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_payments_pending_auto_topup_per_tenant" ON "payments" USING btree ("tenant_id") WHERE "payments"."kind" = 'auto_topup' AND "payments"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind_check" CHECK ("payments"."kind" IN ('topup', 'auto_topup', 'collection'));
