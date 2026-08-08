-- Close the same boundary 0128/0129/0130 closed, on the four remaining tables where a REVOKE is
-- unambiguously correct.
--
-- THE CLASS OF BUG (restated because this is the fourth migration to fix an instance of it).
-- `ALTER DEFAULT PRIVILEGES` (0001) grants `app_runtime` SELECT/INSERT/UPDATE/DELETE on every table
-- the migrator creates. A table is therefore protected by exactly one of two things: an RLS policy
-- scoping rows to the ambient tenant, or an explicit REVOKE. A table with NEITHER is fully readable
-- and writable by the tenant-facing role. All four below carry a `tenant_id` column, which is what
-- made them look protected — but none of them has row-level security enabled, so the column is
-- decoration and nothing filters a tenant-scoped query.
--
-- HOW THESE WERE FOUND. A read-only sweep of all 68 public tables asking Postgres directly —
-- `has_table_privilege('app_runtime', …)` against `relrowsecurity` and the presence of `tenant_id` —
-- rather than reading comments or the schema file. That is the only method that works here: a
-- comment claiming "provisioner-only" is not a grant, and 0128's `token_purchases` hole existed for
-- exactly that reason.
--
-- `auto_topup` — MONEY, CROSS-TENANT. Holds each workspace's automatic top-up rule: the balance
-- threshold that triggers it, the amount to charge, and the currency. Read is another workspace's
-- funding posture. Write is worse than disclosure: `auto-topup.service.ts` reads `enabled`,
-- `threshold_minor` and `top_up_minor` in `maybeAutoTopUp`:137 and charges the saved card from them,
-- and the raw-SQL claim job at :228 selects rows to act on by `enabled` alone — so a writable row is
-- an instruction to charge somebody else's card an amount of the attacker's choosing.
--
-- `payment_authorizations` — the SAVED CARD. One row per reusable provider authorization, which is
-- what `chargeSavedCard` spends. Read exposes which workspaces have a card on file; write lets a
-- workspace point an authorization id at itself, and the auto-top-up path then charges a card it does
-- not own.
--
-- `plugin_instances` — PROVIDER ROUTING AND CREDENTIAL POINTERS. Platform-wide control-plane rows
-- (most carry `tenant_id IS NULL`) naming the vendor each channel dispatches through, whether it is
-- live or sandbox, which is primary, and `credentials_ref` — the pointer to the encrypted vendor
-- secret. Write is the ability to re-route the platform's SMS traffic to a vendor of the attacker's
-- choosing, or to disable the live instance. This is also the table whose armed live Arkesel
-- credential was destroyed by an unqualified DELETE from a test; that was a separate defect, guarded
-- since by `assertDisposablePluginCatalog()`, but it is the same table being under-protected twice.
--
-- `proposals` — MAKER-CHECKER ITSELF. The queue that requires a second human to approve a risky
-- change. Write access to it defeats the control: a row can be inserted already-approved, or an
-- existing one's `approved_by` set, which is precisely the separation of duties the queue exists to
-- enforce. Nothing about that is tenant-scoped — approvals are staff acts.
--
-- SAFE TO REVOKE — every accessor below was opened and read. The enumeration was also re-derived
-- independently after the first pass, which is how the raw-SQL site and `getSavedMethod` were caught:
-- a drizzle-symbol grep alone misses `tx.execute(sql\`…\`)`, and that is exactly the accessor most
-- likely to break in production rather than at build time.
--   auto_topup              FOUR sites, all `provisioning.db`: `auto-topup.service.ts`
--                           getAutoTopup:64, upsert:112, maybeAutoTopUp:137, and — the one a
--                           symbol grep does not see — the RAW SQL claim job in `scheduledCheck`
--                           at :228, a `WITH due AS (SELECT id FROM auto_topup … FOR UPDATE SKIP
--                           LOCKED) UPDATE auto_topup …` inside
--                           `provisioning.db.transaction(...)`. The service injects both
--                           PROVISIONING_DB and APP_DB, but its only `appDb.withTenant` block is
--                           `customerBalance`:275, which reads `ledger_accounts` alone. No
--                           `auto_topup` statement runs on `AppDb`. `payments.controller.ts` reaches
--                           the table only through the service.
--   payment_authorizations  `auto-topup.service.ts:70,94,148`, `payments.service.ts:256`
--                           (`getSavedMethod` — the Payment-method card read), and
--                           `payment-webhook-effects.ts:41` (`captureReusableCard`, invoked as
--                           `captureReusableCard(deps.provisioning, …)` from
--                           `payment-settlement.ts:39`). All `provisioning.db`; the settlement's own
--                           `tx` is used for the wallet legs, not this table.
--   plugin_instances        `plugin-resolver.service.ts` (193, 258 — the SEND path, so this is the
--                           one that had to be right; its constructor at :93 takes PROVISIONING_DB
--                           and ConfigService only, so no `AppDb` exists in the class),
--                           `plugin-registry.service.ts` (52, 71, 92, 111, 213, 227, 256),
--                           `plugin-credentials.service.ts` (63, 121),
--                           `plugin-webhook-credentials.ts` (52, 68) and
--                           `testing/disposable-plugin-catalog.ts`. Not one holds an `AppDb`.
--   proposals               `proposals.service.ts` injects only PROVISIONING_DB — the class imports
--                           no `AppDb` type at all, so it is provisioning-only by construction. Both
--                           consoles reach it over HTTP (`/internal/admin/proposals`), never SQL.
--
-- ON THE PROVISIONER GRANTS BELOW — AND WHAT THEY DO NOT ENFORCE. These are belt-and-braces: locally
-- that connection is a superuser, and in the cloud `prepareRoles()` (`src/cloud-migrate.ts:123`) runs
-- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_provisioner` before
-- every `migrate()`. So withholding DELETE on `auto_topup` and `payment_authorizations` — nothing in
-- application code deletes either; the only deletes are superuser test cleanup — records the intended
-- reach but is NOT enforced: the next deploy re-grants it. Treat it as documentation. Enforcing it
-- would need a re-assertion in `cloud-migrate-privileges.ts`, which is how the GL tables keep their
-- narrowing; that is deliberately out of scope here. `plugin_instances` and `proposals` are granted
-- DELETE because the registry re-seeds the catalog and proposals are removed for real.
--
-- These REVOKEs survive a redeploy because `prepareRoles()` re-grants to `app_provisioner` only,
-- never to `app_runtime`. All four are added to the `db:assert security` loop regardless, because a
-- boundary nothing re-checks drifts back — that is the lesson of this being the fourth such
-- migration, not the first.
REVOKE ALL PRIVILEGES ON "auto_topup" FROM PUBLIC, app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "auto_topup" TO app_provisioner;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON "payment_authorizations" FROM PUBLIC, app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_authorizations" TO app_provisioner;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON "plugin_instances" FROM PUBLIC, app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "plugin_instances" TO app_provisioner;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON "proposals" FROM PUBLIC, app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "proposals" TO app_provisioner;
