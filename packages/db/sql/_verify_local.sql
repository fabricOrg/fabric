-- ================================================================================================
-- LOCAL VERIFICATION HARNESS (not a migration; underscore-prefixed so drizzle-kit ignores it).
-- Proves the ledger-double-entry v1.0.0 schema + 0001/0002 security layer actually behave, against
-- real Postgres. Applies: table DDL (mirrors the drizzle-generated shape) -> 0001 roles+RLS ->
-- 0002 wallet RLS + wallets view; then asserts. Any failed assertion RAISEs and aborts (ON_ERROR_STOP).
--
-- Run: docker compose exec -T postgres psql -U app_owner -d app -v ON_ERROR_STOP=1 -f - < this
-- ================================================================================================

-- Clean slate (idempotent re-run) --------------------------------------------------------------
DROP VIEW  IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS ledger_entries, ledger_transactions, ledger_accounts,
                     erasure_log, pii_vault, dek_keys, data_subjects,
                     memberships, users, accounts CASCADE;
DROP TYPE  IF EXISTS ledger_account_kind, ledger_account_status, ledger_reason, ledger_direction,
                     ledger_txn_status, ledger_txn_type, dek_status, pii_kind,
                     user_status, membership_role, account_status CASCADE;

-- ---- Enums (mirror src/schema/*) ----------------------------------------------------------------
CREATE TYPE account_status       AS ENUM ('active','suspended','closed');
CREATE TYPE membership_role       AS ENUM ('owner','admin','member');
CREATE TYPE user_status           AS ENUM ('active','invited','disabled');
CREATE TYPE pii_kind              AS ENUM ('phone','body','attribute');
CREATE TYPE dek_status            AS ENUM ('active','destroyed');
CREATE TYPE ledger_txn_type       AS ENUM ('topup','sms_charge','adjustment','refund');
CREATE TYPE ledger_txn_status     AS ENUM ('pending','committed','refunded','reconciled');
CREATE TYPE ledger_direction      AS ENUM ('credit','debit');
CREATE TYPE ledger_reason         AS ENUM ('topup','sms_reserve','sms_commit','sms_refund','message_reserve','message_commit','message_refund','adjustment');
CREATE TYPE ledger_account_status AS ENUM ('active','frozen','closed');
CREATE TYPE ledger_account_kind   AS ENUM ('customer','reserved_clearing','revenue','gateway_clearing','writeoff');

-- ---- Tables (mirror the typed schema; owner-created) --------------------------------------------
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, slug text NOT NULL UNIQUE,
  status account_status NOT NULL DEFAULT 'active',
  plan text NOT NULL DEFAULT 'free',
  data_region text NOT NULL DEFAULT 'af-south-1',
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject_id text NOT NULL UNIQUE, email text NOT NULL, name text,
  status user_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES accounts(id) ON DELETE cascade,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  role membership_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_membership_tenant_user UNIQUE (tenant_id, user_id)
);
CREATE TABLE data_subjects (
  subject_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES accounts(id) ON DELETE cascade,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dek_keys (
  dek_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES accounts(id) ON DELETE cascade,
  subject_id uuid NOT NULL REFERENCES data_subjects(subject_id) ON DELETE cascade,
  wrapped_dek bytea, status dek_status NOT NULL DEFAULT 'active', destroyed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pii_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES accounts(id) ON DELETE cascade,
  subject_id uuid NOT NULL REFERENCES data_subjects(subject_id) ON DELETE cascade,
  kind pii_kind NOT NULL, ciphertext bytea NOT NULL,
  dek_id uuid NOT NULL REFERENCES dek_keys(dek_id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE erasure_log (          -- F4: RESTRICT (evidence survives account removal)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES accounts(id) ON DELETE restrict,
  subject_id uuid NOT NULL, requested_by text NOT NULL, basis text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE ledger_accounts (      -- F1: generalizes wallets with a kind
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES accounts(id) ON DELETE restrict,   -- F4
  kind ledger_account_kind NOT NULL, currency char(3) NOT NULL,
  balance_minor bigint NOT NULL DEFAULT 0, version bigint NOT NULL DEFAULT 0,
  status ledger_account_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_ledger_account_tenant_currency_kind UNIQUE (tenant_id, currency, kind)
);
CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES accounts(id) ON DELETE restrict,   -- F4
  type ledger_txn_type NOT NULL, status ledger_txn_status NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,                                        -- B8
  metadata jsonb NOT NULL DEFAULT '{}',
  reference_type text, reference_id uuid,                                -- B6 backstop subject
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_ledger_txn_idempotency UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ledger_txn_idempotency_key_non_empty CHECK (length(idempotency_key) > 0)  -- B8
);
-- B6 DB backstop: at most one terminal-resolution (committed|refunded) sms_charge txn per message.
CREATE UNIQUE INDEX uniq_ledger_txn_resolution_per_message
  ON ledger_transactions (tenant_id, reference_id)
  WHERE type = 'sms_charge' AND status IN ('committed', 'refunded');
CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES accounts(id) ON DELETE restrict,   -- F4
  txn_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE restrict,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE restrict,
  direction ledger_direction NOT NULL, amount_minor bigint NOT NULL,
  reason ledger_reason NOT NULL, reference_type text, reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entry_amount_positive CHECK (amount_minor > 0)
);

\echo '== DDL applied. Applying 0001 (roles + RLS) and 0002 (wallet RLS + wallets view) =='
\i 0001_rls_and_roles.sql
\i 0002_wallet_rls.sql
\echo '== Security layer applied. Running assertions =='

-- Fixed tenant ids for deterministic assertions
\set T1 '11111111-1111-1111-1111-111111111111'
\set T2 '22222222-2222-2222-2222-222222222222'

-- Seed two tenants as OWNER (superuser bypasses RLS for setup only)
INSERT INTO accounts (id, name, slug) VALUES (:'T1','Tenant One','t1'), (:'T2','Tenant Two','t2');

-- ================================================================================================
-- The rest runs as app_runtime (non-owner, no BYPASSRLS) — the realistic runtime role.
-- ================================================================================================

-- A. RLS isolation + B. cross-tenant write block + F. double-entry (balanced reserve) ------------
SET ROLE app_runtime;
BEGIN;
  SET LOCAL app.tenant_id = :'T1';
  -- lazily provision T1's accounts (GHS) — start at ZERO; balances arrive via real posting legs
  -- (so per-account projection integrity holds, not balances set out of thin air).
  INSERT INTO ledger_accounts (tenant_id, kind, currency, balance_minor)
    VALUES (:'T1','customer','GHS',0), (:'T1','reserved_clearing','GHS',0), (:'T1','gateway_clearing','GHS',0);
  -- TOP-UP 10000: debit gateway_clearing / credit customer (balanced)
  WITH t AS (
    INSERT INTO ledger_transactions (tenant_id, type, idempotency_key, reference_type)
      VALUES (:'T1','topup','topup:pay-1','payment') RETURNING id
  )
  INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason)
    SELECT :'T1', t.id, a.id,
           CASE a.kind WHEN 'customer' THEN 'credit'::ledger_direction ELSE 'debit'::ledger_direction END,
           10000, 'topup'::ledger_reason
    FROM t, ledger_accounts a
    WHERE a.tenant_id=:'T1' AND a.currency='GHS' AND a.kind IN ('customer','gateway_clearing');
  UPDATE ledger_accounts SET balance_minor = balance_minor + 10000, version = version + 1
    WHERE tenant_id=:'T1' AND currency='GHS' AND kind='customer';
  UPDATE ledger_accounts SET balance_minor = balance_minor - 10000, version = version + 1
    WHERE tenant_id=:'T1' AND currency='GHS' AND kind='gateway_clearing';
  -- RESERVE 1500: debit customer / credit reserved_clearing (one balanced txn)
  WITH t AS (
    INSERT INTO ledger_transactions (tenant_id, type, idempotency_key)
      VALUES (:'T1','sms_charge','reserve:msg-1') RETURNING id
  )
  INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason)
    SELECT :'T1', t.id, a.id,
           CASE a.kind WHEN 'customer' THEN 'debit'::ledger_direction ELSE 'credit'::ledger_direction END,
           1500,
           CASE a.kind WHEN 'customer' THEN 'sms_reserve'::ledger_reason ELSE 'sms_reserve'::ledger_reason END
    FROM t, ledger_accounts a
    WHERE a.tenant_id = :'T1' AND a.currency='GHS' AND a.kind IN ('customer','reserved_clearing');
  -- move the cached projections in the SAME txn (S5)
  UPDATE ledger_accounts SET balance_minor = balance_minor - 1500, version = version + 1
    WHERE tenant_id=:'T1' AND currency='GHS' AND kind='customer';
  UPDATE ledger_accounts SET balance_minor = balance_minor + 1500, version = version + 1
    WHERE tenant_id=:'T1' AND currency='GHS' AND kind='reserved_clearing';
COMMIT;

BEGIN;
  SET LOCAL app.tenant_id = :'T2';
  INSERT INTO ledger_accounts (tenant_id, kind, currency, balance_minor)
    VALUES (:'T2','customer','NGN',0), (:'T2','gateway_clearing','NGN',0);
  -- TOP-UP 50000 for T2 so its balance is backed by real legs too (projection integrity)
  WITH t AS (
    INSERT INTO ledger_transactions (tenant_id, type, idempotency_key, reference_type)
      VALUES (:'T2','topup','topup:pay-2','payment') RETURNING id
  )
  INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason)
    SELECT :'T2', t.id, a.id,
           CASE a.kind WHEN 'customer' THEN 'credit'::ledger_direction ELSE 'debit'::ledger_direction END,
           50000, 'topup'::ledger_reason
    FROM t, ledger_accounts a
    WHERE a.tenant_id=:'T2' AND a.currency='NGN' AND a.kind IN ('customer','gateway_clearing');
  UPDATE ledger_accounts SET balance_minor = balance_minor + 50000 WHERE tenant_id=:'T2' AND currency='NGN' AND kind='customer';
  UPDATE ledger_accounts SET balance_minor = balance_minor - 50000 WHERE tenant_id=:'T2' AND currency='NGN' AND kind='gateway_clearing';
COMMIT;

-- A. T1 context sees ONLY T1 accounts (not T2's)
DO $$
DECLARE seen int; leaked int;
BEGIN
  PERFORM set_config('app.tenant_id','11111111-1111-1111-1111-111111111111', false);
  SELECT count(*) INTO seen   FROM ledger_accounts;
  SELECT count(*) INTO leaked FROM ledger_accounts WHERE currency='NGN';  -- T2's
  IF seen <> 3   THEN RAISE EXCEPTION 'A FAIL: T1 should see 3 accounts, saw %', seen; END IF;
  IF leaked <> 0 THEN RAISE EXCEPTION 'A FAIL: T1 leaked % T2 rows', leaked; END IF;
  RAISE NOTICE 'A PASS: RLS isolation — T1 sees only its own 3 accounts, 0 T2 leakage';
END $$;

-- B. Cross-tenant write is blocked by WITH CHECK
DO $$
BEGIN
  PERFORM set_config('app.tenant_id','11111111-1111-1111-1111-111111111111', false);
  BEGIN
    INSERT INTO ledger_accounts (tenant_id, kind, currency) VALUES
      ('22222222-2222-2222-2222-222222222222','revenue','GHS');  -- tagged as T2 while in T1 context
    RAISE EXCEPTION 'B FAIL: cross-tenant insert should have been blocked';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'B PASS: WITH CHECK blocked a cross-tenant write';
  END;
END $$;

-- F. Double-entry: per-txn trial balance = 0 AND per-account projection integrity
DO $$
DECLARE txn_delta bigint; cust bigint; clr bigint;
BEGIN
  PERFORM set_config('app.tenant_id','11111111-1111-1111-1111-111111111111', false);
  SELECT SUM(CASE direction WHEN 'credit' THEN amount_minor ELSE -amount_minor END)
    INTO txn_delta FROM ledger_entries;                        -- Σ signed legs across the reserve txn
  IF txn_delta <> 0 THEN RAISE EXCEPTION 'F FAIL: trial balance != 0 (got %)', txn_delta; END IF;
  SELECT balance_minor INTO cust FROM ledger_accounts WHERE kind='customer' AND currency='GHS';
  SELECT balance_minor INTO clr  FROM ledger_accounts WHERE kind='reserved_clearing' AND currency='GHS';
  IF cust <> 8500 THEN RAISE EXCEPTION 'F FAIL: customer balance should be 8500, got %', cust; END IF;
  IF clr  <> 1500 THEN RAISE EXCEPTION 'F FAIL: reserved_clearing should be 1500, got %', clr; END IF;
  RAISE NOTICE 'F PASS: double-entry — trial balance=0; customer 10000->8500, reserved_clearing 0->1500 (balance moved once)';
END $$;

-- F2. Per-account projection integrity (adams' stronger invariant): every account's cached
-- balance_minor equals SUM(credit)-SUM(debit) of ITS legs. Strictly stronger than trial-balance —
-- catches "balance set without a matching entry-set". RLS-scoped to the current tenant (T1).
DO $$
DECLARE bad int;
BEGIN
  PERFORM set_config('app.tenant_id','11111111-1111-1111-1111-111111111111', false);
  SELECT count(*) INTO bad FROM (
    SELECT a.id, a.balance_minor,
           COALESCE(SUM(CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END),0) AS derived
    FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
    GROUP BY a.id, a.balance_minor
    HAVING a.balance_minor <> COALESCE(SUM(CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END),0)
  ) drift;
  IF bad <> 0 THEN RAISE EXCEPTION 'F2 FAIL: % account(s) with projection drift', bad; END IF;
  RAISE NOTICE 'F2 PASS: projection integrity — every account balance_minor == SUM(cr)-SUM(dr) of its legs (T1 GHS: cust 8500, reserved 1500, gateway -10000)';
END $$;

-- C. Append-only: app_runtime cannot UPDATE or DELETE ledger_entries
DO $$
BEGIN
  PERFORM set_config('app.tenant_id','11111111-1111-1111-1111-111111111111', false);
  BEGIN
    UPDATE ledger_entries SET amount_minor = 1 WHERE true;
    RAISE EXCEPTION 'C FAIL: UPDATE on ledger_entries should be denied';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'C PASS: append-only — UPDATE on ledger_entries denied to app_runtime';
  END;
END $$;

-- G. wallets view returns only customer accounts and respects RLS
DO $$
DECLARE n int; kinds int;
BEGIN
  PERFORM set_config('app.tenant_id','11111111-1111-1111-1111-111111111111', false);
  SELECT count(*) INTO n FROM wallets;                    -- only T1's customer wallet
  IF n <> 1 THEN RAISE EXCEPTION 'G FAIL: wallets view should show 1 customer wallet for T1, got %', n; END IF;
  RAISE NOTICE 'G PASS: wallets view = customer-kind only, RLS-scoped (1 row for T1)';
END $$;

-- B8. empty and NULL idempotency keys are rejected
DO $$
BEGIN
  PERFORM set_config('app.tenant_id','11111111-1111-1111-1111-111111111111', false);
  BEGIN
    INSERT INTO ledger_transactions (tenant_id, type, idempotency_key)
      VALUES ('11111111-1111-1111-1111-111111111111','topup','');
    RAISE EXCEPTION 'B8 FAIL: empty idempotency_key should be rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'B8 PASS: empty idempotency_key rejected by CHECK';
  END;
END $$;

-- B6. commit-XOR-refund: a message can have at most one terminal-resolution txn
DO $$
BEGIN
  PERFORM set_config('app.tenant_id','11111111-1111-1111-1111-111111111111', false);
  -- first resolution: COMMIT for msg-1 (deterministic key commit:msg-1)
  INSERT INTO ledger_transactions (tenant_id, type, status, idempotency_key, reference_type, reference_id)
    VALUES ('11111111-1111-1111-1111-111111111111','sms_charge','committed','commit:msg-1','message',
            '33333333-3333-3333-3333-333333333333');
  BEGIN
    -- racing REFUND for the SAME message (different key refund:msg-1) must be rejected by the backstop
    INSERT INTO ledger_transactions (tenant_id, type, status, idempotency_key, reference_type, reference_id)
      VALUES ('11111111-1111-1111-1111-111111111111','sms_charge','refunded','refund:msg-1','message',
              '33333333-3333-3333-3333-333333333333');
    RAISE EXCEPTION 'B6 FAIL: commit AND refund both landed for one message';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'B6 PASS: commit-XOR-refund — 2nd resolution for msg-1 blocked by partial unique index';
  END;
END $$;

RESET ROLE;

-- F4. account hard-delete is blocked by RESTRICT (owner/superuser — FK applies regardless of RLS)
DO $$
BEGIN
  BEGIN
    DELETE FROM accounts WHERE id = '11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'F4 FAIL: account delete should be blocked by RESTRICT';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'F4 PASS: account hard-delete blocked by RESTRICT (ledger history preserved) — soft-close only';
  END;
END $$;

\echo '== ALL ASSERTIONS PASSED =='

-- ---- CLEANUP (adams' hygiene ask): leave NO residue on the shared local DB. Drop everything this
-- harness created so a later read-only query never trips over half-seeded test data. Re-runnable
-- (the header re-creates it all). The app_runtime role is left in place (shared infra, not data). --
DROP VIEW  IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS ledger_entries, ledger_transactions, ledger_accounts,
                     erasure_log, pii_vault, dek_keys, data_subjects,
                     memberships, users, accounts CASCADE;
DROP TYPE  IF EXISTS ledger_account_kind, ledger_account_status, ledger_reason, ledger_direction,
                     ledger_txn_status, ledger_txn_type, dek_status, pii_kind,
                     user_status, membership_role, account_status CASCADE;
\echo '== Cleaned up: no test data left on the shared DB =='
