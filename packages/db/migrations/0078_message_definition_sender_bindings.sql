CREATE TABLE "message_definition_sender_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_def_sender_id_length_check" CHECK (length("message_definition_sender_bindings"."sender_id") BETWEEN 1 AND 11)
);
--> statement-breakpoint
ALTER TABLE "message_definition_sender_bindings" ADD CONSTRAINT "message_definition_sender_bindings_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_definition_sender_bindings" ADD CONSTRAINT "message_def_sender_definition_containment_fk" FOREIGN KEY ("definition_id","tenant_id","application_id") REFERENCES "public"."message_definitions"("id","tenant_id","application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_definition_sender_bindings" ADD CONSTRAINT "message_def_sender_environment_containment_fk" FOREIGN KEY ("environment_id","application_id","tenant_id") REFERENCES "public"."environments"("id","application_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_message_def_sender_env_definition" ON "message_definition_sender_bindings" USING btree ("tenant_id","environment_id","definition_id");