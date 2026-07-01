-- ================================================================================================
-- LEDGER WRITE-TIME ENFORCEMENT (E3) — make the money invariants correct-by-construction.
-- Moves three invariants from app-code + CI-checked to DB-ENFORCED: a violating write is REJECTED by
-- the database, not detected after the fact. See docs/PI-1/LEDGER-WRITE-TIME-ENFORCEMENT.md.
-- Custom migration (triggers/plpgsql aren't in the Drizzle DSL); wire after the table migrations.
-- MUST be verified against a NON-super owner (a superuser bypasses triggers — the fidelity trap the
-- non-super-owner change closes). Functions are owned by the migration owner, search_path pinned.
-- ================================================================================================

-- ---- Trigger B: DB-MAINTAINED balance projection (immediate, per leg) ---------------------------
-- The projection can no longer drift from the legs — the DB increments it atomically with each entry.
-- REPLACES @app/wallet's moveBalance (the primitives stop writing balance_minor; this owns it).
-- version+1 preserved so optimistic-lock reads elsewhere still work. SECURITY INVOKER (default): runs
-- as the app_runtime caller, so the UPDATE is still RLS-scoped to the tenant (the entry just inserted
-- already passed RLS, and its account is same-tenant).
CREATE OR REPLACE FUNCTION ledger_apply_entry() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE ledger_accounts
     SET balance_minor = balance_minor
           + (CASE NEW.direction WHEN 'credit' THEN NEW.amount_minor ELSE -NEW.amount_minor END),
         version = version + 1
   WHERE id = NEW.account_id;
  RETURN NULL; -- AFTER trigger: return value ignored
END $$;

CREATE TRIGGER trg_ledger_apply_entry
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_entry();

-- ---- Trigger A: deferred per-transaction constraint (balanced + single-currency) ----------------
-- DEFERRABLE INITIALLY DEFERRED → fires at COMMIT, so the app may insert a txn's legs incrementally;
-- the check only makes sense on the COMPLETE transaction. For the row's txn_id: assert the double-
-- entry balance (Σ signed legs = 0) and that all legs share ONE currency. Either violation → the
-- transaction CANNOT commit.
CREATE OR REPLACE FUNCTION ledger_assert_txn_balanced() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  net_minor bigint;
  currency_count int;
BEGIN
  SELECT
    COALESCE(SUM(CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END), 0),
    COUNT(DISTINCT a.currency)
    INTO net_minor, currency_count
    FROM ledger_entries e
    JOIN ledger_accounts a ON a.id = e.account_id
   WHERE e.txn_id = NEW.txn_id;

  IF net_minor <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (net = %); every txn must satisfy SUM(credits)=SUM(debits)',
      NEW.txn_id, net_minor USING ERRCODE = 'check_violation';
  END IF;
  IF currency_count > 1 THEN
    RAISE EXCEPTION 'ledger transaction % spans % currencies; a transaction must be single-currency',
      NEW.txn_id, currency_count USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_ledger_txn_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_txn_balanced();
