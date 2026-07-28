-- USING is required: text → uuid has no assignment cast, so Postgres refuses the plain form with
-- "column cannot be cast automatically". Safe here because credentials_ref was never written —
-- configure() did not exist until this slice, so every row holds NULL.
ALTER TABLE "plugin_instances"
  ALTER COLUMN "credentials_ref" SET DATA TYPE uuid USING "credentials_ref"::uuid;--> statement-breakpoint
ALTER TABLE "plugin_instances" ADD CONSTRAINT "plugin_instances_credentials_ref_plugin_credentials_id_fk" FOREIGN KEY ("credentials_ref") REFERENCES "public"."plugin_credentials"("id") ON DELETE set null ON UPDATE no action;