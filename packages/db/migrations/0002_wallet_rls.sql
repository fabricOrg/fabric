-- ================================================================================================
-- WALLET / LEDGER RLS — tenant isolation for the money tables (B3). Sibling of sql/0001.
-- Bound to the ratified contract `ledger-double-entry` v1.0.0.
--
-- WHY a separate file: the ledger tables (ledger_accounts, ledger_transactions, ledger_entries) are
-- created by the typed-schema migration (drizzle generate from src/schema/wallet.ts). This file adds
-- the RLS security layer Drizzle's DSL cannot express + the `wallets` compatibility view, and must
-- run AFTER those tables exist.
--
-- HOW TO WIRE IT IN (same flow as 0001, so drizzle-kit tracks it in its journal):
--   1) pnpm db:generate                     # emits the ledger table DDL from the typed schema
--   2) pnpm --filter @app/db exec drizzle-kit generate --custom --name wallet_rls
--   3) paste this file's contents into the new migrations/000X_wallet_rls.sql
--   4) pnpm db:migrate
--
-- MODEL (identical to 0001): the app connects as the non-owner `app_runtime` role (no BYPASSRLS);
-- tenant context is set per-transaction via `SET LOCAL app.tenant_id`. Unset → NULL → 0 rows
-- (fail-closed). The DEFAULT PRIVILEGES from 0001 already grant CRUD on these new tables to
-- app_runtime, so no extra GRANT is needed here (except the view, below).
-- ================================================================================================

-- ---- Enable RLS + FORCE on every ledger table ---------------------------------------------------
-- FORCE also subjects the table OWNER to policies → even a mistaken owner-connection can't bypass
-- tenant isolation on the money path (defense in depth — B4).
ALTER TABLE ledger_accounts      ENABLE ROW LEVEL SECURITY;  ALTER TABLE ledger_accounts      FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_transactions  ENABLE ROW LEVEL SECURITY;  ALTER TABLE ledger_transactions  FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries       ENABLE ROW LEVEL SECURITY;  ALTER TABLE ledger_entries       FORCE ROW LEVEL SECURITY;

-- ---- Policies: classic tenant_id scoping --------------------------------------------------------
-- Each ledger table carries tenant_id (system accounts are per-tenant → uniform isolation). USING
-- gates reads/updates/deletes; WITH CHECK gates writes so a tenant can't INSERT a row tagged with
-- another tenant's id. current_setting(..., true) = missing_ok → returns NULL when app.tenant_id is
-- unset, and `tenant_id = NULL` matches nothing (fail-closed).
CREATE POLICY tenant_isolation ON ledger_accounts FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON ledger_transactions FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON ledger_entries FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ================================================================================================
-- APPEND-ONLY ENFORCEMENT (defense in depth for the ledger's core promise):
-- RLS controls WHICH rows are visible, not WHICH operations are allowed. The append-only rule
-- ("never UPDATE or DELETE a ledger entry; corrections are new adjustment legs") is enforced by
-- REVOKING those rights from the app role — so even an app-layer bug cannot mutate history.
-- ================================================================================================
REVOKE UPDATE, DELETE ON ledger_entries       FROM app_runtime;
REVOKE DELETE          ON ledger_transactions  FROM app_runtime;  -- txn status is UPDATEd (pending→committed); never deleted
REVOKE DELETE          ON ledger_accounts      FROM app_runtime;  -- accounts SOFT-close (status), never hard-delete (F4)

-- ================================================================================================
-- `wallets` COMPATIBILITY VIEW (F1 generalization) — a customer wallet IS a ledger_account of
-- kind='customer'. The `wallets` name survives as a view so the customer-facing API / GET /v1/wallet
-- are unaffected by generalizing the table to ledger_accounts.
--
-- security_invoker=true (PG15+): the view executes with the QUERYING role's privileges, so the
-- underlying ledger_accounts RLS policy still applies to app_runtime through the view (WITHOUT this,
-- a view runs as its owner and would BYPASS RLS — a cross-tenant leak). Read-only by design; all
-- writes go to ledger_accounts directly through the typed schema.
-- ================================================================================================
CREATE VIEW wallets WITH (security_invoker = true) AS
  SELECT id, tenant_id, currency, balance_minor, version, status, created_at, updated_at
  FROM ledger_accounts
  WHERE kind = 'customer';

GRANT SELECT ON wallets TO app_runtime;

-- ================================================================================================
-- Runtime pattern (unchanged from 0001) — the reserve/commit/refund flow runs inside one such block.
-- Every movement is a BALANCED 2-leg transaction; the customer balance moves exactly once:
--   BEGIN;
--     SET LOCAL app.tenant_id = '<tenant-uuid>';   -- FIRST statement, transaction-scoped
--     -- RESERVE: debit customer / credit reserved_clearing (both legs share one txn_id)
--     SELECT balance_minor, version FROM ledger_accounts
--       WHERE tenant_id = ... AND currency = ... AND kind = 'customer' FOR UPDATE;  -- serialize spends
--     -- assert balance_minor >= cost  (S5: reserve NEVER overdraws; only 'adjustment' may go negative)
--     INSERT INTO ledger_transactions (..., idempotency_key = 'reserve:<msgId>');   -- unique dedupes retries
--     INSERT INTO ledger_entries (... 2 balanced legs ...);
--     UPDATE ledger_accounts SET balance_minor = balance_minor - $cost, version = version + 1 WHERE ...;
--   COMMIT;
-- ================================================================================================
