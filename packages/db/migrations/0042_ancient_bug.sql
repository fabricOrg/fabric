ALTER TABLE "virtual_deliveries" DROP CONSTRAINT "virtual_deliveries_message_id_messages_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_messages_id_tenant" ON "messages" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "virtual_deliveries" ADD CONSTRAINT "virtual_deliveries_message_tenant_fk" FOREIGN KEY ("message_id","tenant_id") REFERENCES "public"."messages"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_virtual_deliveries_tenant_created" ON "virtual_deliveries" USING btree ("tenant_id","created_at");
