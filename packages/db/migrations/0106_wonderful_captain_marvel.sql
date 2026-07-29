ALTER TABLE "sandbox_usage_buckets" DROP CONSTRAINT "sandbox_usage_buckets_tenant_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" DROP CONSTRAINT "sandbox_usage_events_tenant_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" DROP CONSTRAINT "sandbox_usage_events_application_tenant_fk";
--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" DROP CONSTRAINT "sandbox_usage_events_environment_application_tenant_fk";
--> statement-breakpoint
ALTER TABLE "sandbox_usage_buckets" ADD CONSTRAINT "sandbox_usage_buckets_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_application_tenant_fk" FOREIGN KEY ("application_id","tenant_id") REFERENCES "public"."applications"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_environment_application_tenant_fk" FOREIGN KEY ("environment_id","application_id","tenant_id") REFERENCES "public"."environments"("id","application_id","tenant_id") ON DELETE cascade ON UPDATE no action;