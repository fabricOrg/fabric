CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"waba_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"category" text,
	"status" text NOT NULL,
	"quality_rating" text,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"status_updated_at" timestamp with time zone NOT NULL,
	"quality_updated_at" timestamp with time zone NOT NULL,
	"category_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_whatsapp_templates_waba_name_language" ON "whatsapp_templates" USING btree ("waba_id","name","language");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_templates_tenant_synced" ON "whatsapp_templates" USING btree ("tenant_id","synced_at");
