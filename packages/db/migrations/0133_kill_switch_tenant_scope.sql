-- TENANT-TARGETABLE KILL SWITCHES. A breaker was all-or-nothing: pausing one abusive sender meant
-- halting SMS for every tenant on the platform. `tenant_id` NULL keeps the platform breaker exactly
-- as it was; a row with a tenant id scopes the same key to one workspace.
--
-- The unique constraint is the whole safety story here, so it is replaced rather than added to. The
-- old `unique(key)` cannot survive a second row per key, and a plain `unique(key, tenant_id)` would
-- be WORSE than what it replaces: Postgres treats NULLs as distinct, so unlimited duplicate PLATFORM
-- rows would be legal — several contradictory answers to "is SMS paused?", for the most common row
-- shape. NULLS NOT DISTINCT (PG15+, as `uniq_plugin_instance` already relies on) gives exactly one
-- platform row per key and at most one override per (key, tenant).
--
-- CASCADE on the FK: deleting a workspace should not leave incident state behind for a tenant that
-- no longer exists. (`plugin_instances.tenant_id` is RESTRICT because routing config IS worth
-- protecting from a deletion; a breaker is not.)
--
-- No grant change. `app_runtime` was REVOKEd from this table in 0132 and stays revoked — `tenant_id`
-- is a SCOPE, not a security boundary, and adding it does not make kill_switches a tenant table:
-- there is no RLS policy here and the only accessor is the provisioning connection.
ALTER TABLE "kill_switches" DROP CONSTRAINT "kill_switches_key_unique";--> statement-breakpoint
ALTER TABLE "kill_switches" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "kill_switches" ADD CONSTRAINT "kill_switches_tenant_id_accounts_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kill_switches" ADD CONSTRAINT "uniq_kill_switch_key_tenant" UNIQUE NULLS NOT DISTINCT("key","tenant_id");