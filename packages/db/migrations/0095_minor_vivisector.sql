CREATE TABLE "plugin_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_instance_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"dek_wrapped" "bytea",
	"ciphertext" "bytea" NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_plugin_credential_version" UNIQUE("plugin_instance_id","version")
);
--> statement-breakpoint
ALTER TABLE "plugin_credentials" ADD CONSTRAINT "plugin_credentials_plugin_instance_id_plugin_instances_id_fk" FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."plugin_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_plugin_credentials_instance" ON "plugin_credentials" USING btree ("plugin_instance_id");