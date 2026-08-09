-- ================================================================================================
-- WHATSAPP INBOUND + the 24-hour customer service window (ADR-0015).
--
-- Hand-written like 0142-0144: the snapshot chain is broken from 0135 onward so `drizzle-kit
-- generate` errors.
--
-- THREE tables, and the split between them is the decision, not an implementation detail:
--   * whatsapp_inbound_messages     — tenant-scoped, FORCE RLS. An attributed reply.
--   * whatsapp_service_windows      — tenant-scoped, FORCE RLS. Whether we may still reply.
--   * whatsapp_unattributed_inbound — CONTROL PLANE, no RLS, provisioner only. A message no tenant
--     owns. It cannot live in a tenant table (there is no tenant), and it deliberately stores nothing
--     about the consumer: with no tenant there is no vault scope to encrypt their number into, and
--     the reason the row exists at all is to be COUNTED.
-- ================================================================================================

CREATE TABLE IF NOT EXISTS "whatsapp_inbound_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE restrict,
  "application_id" uuid NOT NULL REFERENCES "applications"("id") ON DELETE restrict,
  "environment_id" uuid NOT NULL REFERENCES "environments"("id") ON DELETE restrict,
  "subject_id" uuid NOT NULL REFERENCES "data_subjects"("subject_id") ON DELETE restrict,
  "content_pii_id" uuid REFERENCES "pii_vault"("id") ON DELETE set null,
  "provider_ref" text NOT NULL,
  "message_type" text NOT NULL,
  "received_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Scoped by tenant rather than global: a wamid can only arrive once anyway, and scoping the index to
-- the tenant keeps it aligned with every RLS-filtered read that will use it.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_whatsapp_inbound_provider_ref"
  ON "whatsapp_inbound_messages" ("tenant_id", "provider_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whatsapp_inbound_tenant_received"
  ON "whatsapp_inbound_messages" ("tenant_id", "received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whatsapp_inbound_subject"
  ON "whatsapp_inbound_messages" ("tenant_id", "subject_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "whatsapp_service_windows" (
  "tenant_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE restrict,
  "subject_id" uuid NOT NULL REFERENCES "data_subjects"("subject_id") ON DELETE restrict,
  "last_inbound_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_service_windows_pkey" PRIMARY KEY ("tenant_id", "subject_id"),
  CONSTRAINT "whatsapp_service_window_expiry_chk" CHECK ("expires_at" > "last_inbound_at")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whatsapp_service_windows_expiry"
  ON "whatsapp_service_windows" ("tenant_id", "expires_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "whatsapp_unattributed_inbound" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_ref" text NOT NULL,
  "phone_number_id" text NOT NULL,
  "message_type" text NOT NULL,
  "received_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_whatsapp_unattributed_provider_ref"
  ON "whatsapp_unattributed_inbound" ("provider_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whatsapp_unattributed_received"
  ON "whatsapp_unattributed_inbound" ("received_at");--> statement-breakpoint

-- ---- RLS on the two tenant tables ---------------------------------------------------------------
ALTER TABLE whatsapp_inbound_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE whatsapp_inbound_messages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_inbound_messages;--> statement-breakpoint
CREATE POLICY tenant_isolation ON whatsapp_inbound_messages FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_read ON whatsapp_inbound_messages;--> statement-breakpoint
CREATE POLICY provisioner_read ON whatsapp_inbound_messages FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint

ALTER TABLE whatsapp_service_windows ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE whatsapp_service_windows FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_service_windows;--> statement-breakpoint
CREATE POLICY tenant_isolation ON whatsapp_service_windows FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS provisioner_read ON whatsapp_service_windows;--> statement-breakpoint
CREATE POLICY provisioner_read ON whatsapp_service_windows FOR SELECT TO app_provisioner
  USING (true);--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'whatsapp_inbound_messages' AND tableowner <> 'app_migrator') THEN
      ALTER TABLE whatsapp_inbound_messages OWNER TO app_migrator;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'whatsapp_service_windows' AND tableowner <> 'app_migrator') THEN
      ALTER TABLE whatsapp_service_windows OWNER TO app_migrator;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'whatsapp_unattributed_inbound' AND tableowner <> 'app_migrator') THEN
      ALTER TABLE whatsapp_unattributed_inbound OWNER TO app_migrator;
    END IF;
  END IF;
END $$;--> statement-breakpoint

-- ---- Grants. A GRANT cannot narrow anything -----------------------------------------------------
-- `ALTER DEFAULT PRIVILEGES` (0001) already handed app_runtime FULL DML on every table the migrator
-- creates, so the REVOKEs below are the only thing that removes what we do not want. Read the result
-- back with `has_table_privilege` on a FRESH database — the hole is grantor-scoped, so an
-- app_owner-owned local copy looks clean while CI and prod do not.
--
-- An inbound message is the evidence that a conversation happened, and the service window is what
-- authorises a free-form reply. Neither is the tenant-facing role's to delete: deleting a window row
-- would let a workspace quietly reset the record of when its right to send free-form expired.
REVOKE DELETE, TRUNCATE ON whatsapp_inbound_messages FROM app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON whatsapp_inbound_messages TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_inbound_messages TO app_provisioner;--> statement-breakpoint

REVOKE DELETE, TRUNCATE ON whatsapp_service_windows FROM app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON whatsapp_service_windows TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_service_windows TO app_provisioner;--> statement-breakpoint

-- Control plane: the tenant-facing role has no business reading a table that spans every tenant on
-- the WABA, so this one is REVOKEd outright rather than narrowed.
REVOKE ALL ON whatsapp_unattributed_inbound FROM app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_unattributed_inbound TO app_provisioner;
