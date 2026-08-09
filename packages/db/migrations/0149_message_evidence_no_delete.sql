-- ================================================================================================
-- REVOKE app_runtime's DELETE on the message/delivery evidence tables.
--
-- 0001 does two things that make this necessary: it GRANTs app_runtime full DML on ALL TABLES, and it
-- sets `ALTER DEFAULT PRIVILEGES` so every table created afterwards inherits the same. So DELETE is
-- present unless a migration explicitly takes it away, and a GRANT cannot narrow anything —
-- `GRANT SELECT, INSERT, UPDATE` (0063_email_rls.sql:8) reads like a restriction and is not one.
--
-- Only the WhatsApp pair was ever closed (0135, 0137). Their own migration said so at the time:
-- "on a FRESH database app_runtime can DELETE from `messages` and `email_messages` today. That is
-- tracked separately as a sweep." This is that sweep.
--
-- WHY IT MATTERS: a message row is the ledger's `reference_id` target and the billing evidence that a
-- send happened. Deleting one orphans a COMMITTED wallet transaction — the charge stays, the reason for
-- it disappears — and leaves the customer no record of what they paid for. A dispatch row is the
-- recovery intent, so deleting it strands a reserve the sweeper can no longer find. An outbox event is
-- an at-least-once promise to a customer's webhook.
--
-- WHY IT IS SAFE: nothing in the runtime deletes any of these. Verified per table rather than assumed —
-- `messages`, `email_messages`, the three dispatch tables and `outbox_events` have no delete path at
-- all, and the ONE that does (`message_deliveries` / `message_delivery_attempts`, the retention
-- sweeper in maintenance-retention.ts) runs on the PROVISIONING connection, which keeps its DELETE.
-- Citing a sibling as the reason a table is safe is the mistake this repo has already made twice; each
-- line below was checked on its own.
--
-- WHY THIS READS CLEAN ON A DIRTY LOCAL DB: `ALTER DEFAULT PRIVILEGES` is grantor-scoped, so the hole
-- only appears on app_migrator-owned tables. An app_owner-owned local copy looks correct while a freshly
-- migrated CI/prod database does not. Assert with `has_table_privilege` on a FRESH database, never by
-- reading this file.
--
-- Hand-written like 0142-0148 — the snapshot chain is broken from 0135 onward.
-- ================================================================================================

-- Billing + audit evidence for a send. No runtime deleter.
REVOKE DELETE, TRUNCATE ON messages FROM app_runtime;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON email_messages FROM app_runtime;--> statement-breakpoint

-- Dispatch intent: deleting one strands whatever the reserve was holding, because the recovery
-- sweeper finds work THROUGH these rows.
REVOKE DELETE, TRUNCATE ON message_dispatches FROM app_runtime;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON email_dispatches FROM app_runtime;--> statement-breakpoint

-- Managed delivery evidence. Retention DOES delete these — through the provisioning connection, which
-- is untouched below, so pruning still works and the tenant-facing role still cannot destroy history.
REVOKE DELETE, TRUNCATE ON message_deliveries FROM app_runtime;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON message_delivery_attempts FROM app_runtime;--> statement-breakpoint

-- An at-least-once promise to a customer's webhook. Deleting an undelivered event silently breaks it.
REVOKE DELETE, TRUNCATE ON outbox_events FROM app_runtime;--> statement-breakpoint

-- Re-GRANT the writes these paths genuinely need. Listed explicitly so the positive half is visible:
-- a REVOKE that took INSERT or UPDATE with it would break sending in a way no read-only check notices,
-- which is why security-layer.check.ts now asserts BOTH directions.
GRANT SELECT, INSERT, UPDATE ON messages TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON email_messages TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON message_dispatches TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON email_dispatches TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON message_deliveries TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON message_delivery_attempts TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON outbox_events TO app_runtime;--> statement-breakpoint

-- The provisioning connection keeps DELETE: retention prunes expired deliveries through it, and
-- `prepareRoles()` re-grants it full DML before every deploy's migrate() anyway, so pretending
-- otherwise here would be a comment that lies.
GRANT SELECT, INSERT, UPDATE, DELETE ON messages, email_messages,
  message_dispatches, email_dispatches, message_deliveries,
  message_delivery_attempts, outbox_events TO app_provisioner;
