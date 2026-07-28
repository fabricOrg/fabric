ALTER TABLE "plugin_instances" DROP CONSTRAINT "uniq_plugin_instance";--> statement-breakpoint
ALTER TABLE "plugin_instances" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "plugin_instances" ADD CONSTRAINT "plugin_instances_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_instances" ADD CONSTRAINT "uniq_plugin_instance" UNIQUE NULLS NOT DISTINCT("tenant_id","capability","vendor","mode");