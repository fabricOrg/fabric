CREATE TABLE IF NOT EXISTS "whatsapp_dispatches" (
  "message_id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "whatsapp_dispatches" ADD CONSTRAINT "whatsapp_dispatches_message_id_whatsapp_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."whatsapp_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "whatsapp_dispatches" ADD CONSTRAINT "whatsapp_dispatches_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whatsapp_dispatches_pending" ON "whatsapp_dispatches" USING btree ("available_at","message_id") WHERE completed_at IS NULL;--> statement-breakpoint
ALTER TABLE whatsapp_dispatches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE whatsapp_dispatches FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_dispatches;--> statement-breakpoint
CREATE POLICY tenant_isolation ON whatsapp_dispatches FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_read ON whatsapp_dispatches;--> statement-breakpoint
CREATE POLICY provisioner_read ON whatsapp_dispatches FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator')
     AND EXISTS (
       SELECT 1 FROM pg_tables
       WHERE tablename = 'whatsapp_dispatches' AND tableowner <> 'app_migrator'
     ) THEN
    ALTER TABLE whatsapp_dispatches OWNER TO app_migrator;
  END IF;
END $$;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON whatsapp_dispatches FROM app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON whatsapp_dispatches TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_dispatches TO app_provisioner;
