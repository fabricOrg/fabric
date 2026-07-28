-- ADR-0011 slice 1 — grants for plugin_credentials.
--
-- PLATFORM config, not tenant data: like plugin_instances it carries no tenant_id and gets no RLS,
-- because there is no tenant to scope it to. Access control here is the GRANT itself.
--
-- Only app_provisioner. The runtime role deliberately gets nothing: provider resolution runs on the
-- provisioning connection (as PluginRegistryService already does), so the RLS-scoped data-plane role
-- never needs to read vendor secrets. Granting it SELECT would put every tenant-facing query one
-- mistake away from reading platform credentials.
--
-- Idempotent: GRANT is naturally repeatable, and the role guard keeps this replayable on a database
-- provisioned without app_provisioner (local docker before the role migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_provisioner') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON plugin_credentials TO app_provisioner;
  END IF;

  -- REVOKE is not belt-and-braces here, it is load-bearing. ALTER DEFAULT PRIVILEGES grants the
  -- runtime role DML on every table the migrator creates, so this table arrived with app_runtime
  -- already holding SELECT — a default that is right for tenant tables and wrong for a credential
  -- vault. Without this, every tenant-facing query runs one mistake away from reading vendor
  -- secrets, and nothing in the schema would have said so.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    REVOKE ALL ON plugin_credentials FROM app_runtime;
  END IF;
END
$$;
