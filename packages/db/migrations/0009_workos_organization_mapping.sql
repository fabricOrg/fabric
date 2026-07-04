ALTER TABLE "accounts" ADD COLUMN "workos_organization_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workos_organization_id_unique" UNIQUE("workos_organization_id");
