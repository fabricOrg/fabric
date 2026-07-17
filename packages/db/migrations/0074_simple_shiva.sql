CREATE UNIQUE INDEX "uniq_webhook_deliveries_tenant_containment" ON "webhook_deliveries" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_tenant_containment_fk" FOREIGN KEY ("delivery_id","tenant_id") REFERENCES "public"."webhook_deliveries"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
