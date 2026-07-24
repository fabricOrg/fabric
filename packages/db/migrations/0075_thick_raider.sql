CREATE TABLE "message_definition_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_definition_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"variable_schema" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"default_locale" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_def_version_positive_check" CHECK ("message_definition_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "message_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_definitions_status_check" CHECK ("message_definitions"."status" IN ('draft', 'active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_def_release_env_definition" ON "message_definition_releases" USING btree ("tenant_id","environment_id","definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_def_release_id_tenant" ON "message_definition_releases" USING btree ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_def_version_ordinal" ON "message_definition_versions" USING btree ("definition_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_def_version_id_tenant_def" ON "message_definition_versions" USING btree ("id","tenant_id","definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_def_tenant_app_key" ON "message_definitions" USING btree ("tenant_id","application_id",lower("key"));--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_def_id_tenant_app" ON "message_definitions" USING btree ("id","tenant_id","application_id");--> statement-breakpoint
ALTER TABLE "message_definitions" ADD CONSTRAINT "message_definitions_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_definitions" ADD CONSTRAINT "message_definitions_application_tenant_fk" FOREIGN KEY ("application_id","tenant_id") REFERENCES "public"."applications"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_definition_versions" ADD CONSTRAINT "message_definition_versions_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_definition_versions" ADD CONSTRAINT "message_def_version_definition_containment_fk" FOREIGN KEY ("definition_id","tenant_id","application_id") REFERENCES "public"."message_definitions"("id","tenant_id","application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_definition_releases" ADD CONSTRAINT "message_definition_releases_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_definition_releases" ADD CONSTRAINT "message_def_release_definition_containment_fk" FOREIGN KEY ("definition_id","tenant_id","application_id") REFERENCES "public"."message_definitions"("id","tenant_id","application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_definition_releases" ADD CONSTRAINT "message_def_release_environment_containment_fk" FOREIGN KEY ("environment_id","application_id","tenant_id") REFERENCES "public"."environments"("id","application_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_definition_releases" ADD CONSTRAINT "message_def_release_version_containment_fk" FOREIGN KEY ("version_id","tenant_id","definition_id") REFERENCES "public"."message_definition_versions"("id","tenant_id","definition_id") ON DELETE cascade ON UPDATE no action;
