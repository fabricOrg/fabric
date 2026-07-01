-- ================================================================================================
-- LOCAL DEV DB BOOTSTRAP — runs ONCE at container init (mounted to /docker-entrypoint-initdb.d),
-- as the bootstrap SUPERUSER (POSTGRES_USER=app_owner), against the `app` database.
--
-- WHY (prod fidelity — pascal's superuser-owner trap): the postgres image creates POSTGRES_USER as a
-- SUPERUSER, and a superuser BYPASSES `FORCE ROW LEVEL SECURITY`. If migrations run as that superuser,
-- the tables are owned by a superuser, so FORCE-RLS-vs-owner behaviour is MASKED locally — a
-- SECURITY DEFINER / owner-run query that fails closed in prod (non-super RDS schema owner) returns
-- rows locally. Security gates that run against a superuser owner are therefore a BLIND SPOT.
--
-- FIX: a dedicated NON-SUPERUSER migration owner `app_migrator` owns the DB + schema, so `drizzle-kit`
-- runs as it and every table is owned by a non-superuser → FORCE RLS applies to the owner exactly as
-- in prod. Roles after this:
--   • app_owner   — bootstrap SUPERUSER; TEST-ONLY cross-tenant sweeps (DATABASE_URL_SUPER). Not the owner.
--   • app_migrator — NON-SUPER migration owner; drizzle-kit runs as it (DATABASE_URL_OWNER). Owns tables.
--   • app_runtime  — NON-SUPER runtime role (created by migration 0001); the app (DATABASE_URL_APP).
-- ================================================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    -- LOGIN (drizzle connects), CREATEROLE (migration 0001 creates app_runtime), explicitly NOT super
    -- and NOT BYPASSRLS so FORCE RLS constrains it like the prod schema owner.
    CREATE ROLE app_migrator LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE PASSWORD 'localdev';
  END IF;
END $$;

-- Hand ownership of the DB + schema to the non-super migrator so the objects it creates are
-- non-super-owned (and it can GRANT CONNECT / manage app_runtime in migration 0001).
ALTER DATABASE app OWNER TO app_migrator;
ALTER SCHEMA public OWNER TO app_migrator;
GRANT ALL ON SCHEMA public TO app_migrator;
