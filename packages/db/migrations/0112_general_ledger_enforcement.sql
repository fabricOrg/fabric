-- ================================================================================================
-- CORPORATE GENERAL LEDGER — write-time enforcement, privileges, and the seeded chart of accounts.
-- ADR-0013. Companion to 0111 (the tables) and a deliberate mirror of
-- 0007_ledger_write_time_enforcement.sql, which does the same job for the tenant subledger.
--
-- WHY IMMUTABILITY IS ENFORCED BY TRIGGER AND NOT BY PRIVILEGE. Revoking UPDATE/DELETE would look
-- sufficient and is not: `prepareRoles()` in src/cloud-migrate.ts runs BEFORE migrate() on every
-- deploy and unconditionally issues
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_provisioner
-- plus a matching ALTER DEFAULT PRIVILEGES. This migration is journaled, so it runs once; the grant
-- runs forever. Deploy N would leave the correct state and deploy N+1 would silently hand the control
-- plane the ability to rewrite posted history, with nothing failing. Triggers do not care about
-- grants, so the guarantee holds no matter what the deploy pipeline re-grants.
--
-- NOTE ON WHAT IS *NOT* HERE: no balance-projection trigger, because there is no balance table. The
-- subledger needs one (the send path locks it FOR UPDATE to fail closed on an overdraw); the general
-- ledger has no hot path, so a balance is Σ credits − Σ debits over the append-only lines. That also
-- keeps the zero-SECURITY-DEFINER policy in security-layer.check.ts intact.
-- ================================================================================================

-- ---- Trigger A: deferred per-journal trial balance AND declared-line-count ----------------------
-- DEFERRABLE INITIALLY DEFERRED so it fires at COMMIT: the poster inserts a journal's lines
-- incrementally, and both checks only mean anything once the journal is COMPLETE.
--
-- The line-count half is what makes a journal a CLOSED SET. Balance alone is not enough: a second
-- balanced pair inserted in a LATER transaction also nets to zero, so an append would pass — writing
-- fabricated revenue into an already-closed period while every invariant still reported healthy.
-- Comparing against the count the journal declared at insert rejects both a short journal and an
-- appended one, deterministically and without depending on transaction-timestamp comparisons.
--
-- Single-currency needs no check: currency is a column on the JOURNAL, so it is structural.
DROP TRIGGER IF EXISTS trg_gl_journal_complete ON gl_journal_lines;--> statement-breakpoint
CREATE OR REPLACE FUNCTION gl_assert_journal_complete() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  net_minor bigint;
  actual_lines int;
  declared_lines int;
BEGIN
  SELECT COALESCE(SUM(CASE l.direction WHEN 'credit' THEN l.amount_minor ELSE -l.amount_minor END), 0),
         COUNT(*)
    INTO net_minor, actual_lines
    FROM gl_journal_lines l
   WHERE l.journal_id = NEW.journal_id;

  SELECT j.line_count INTO declared_lines FROM gl_journals j WHERE j.id = NEW.journal_id;

  IF actual_lines <> declared_lines THEN
    RAISE EXCEPTION 'gl journal % has % line(s) but declares %; a journal is a closed set and cannot be appended to',
      NEW.journal_id, actual_lines, declared_lines USING ERRCODE = 'check_violation';
  END IF;
  IF net_minor <> 0 THEN
    RAISE EXCEPTION 'gl journal % is unbalanced (net = %); every journal must satisfy SUM(credits)=SUM(debits)',
      NEW.journal_id, net_minor USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_gl_journal_complete
  AFTER INSERT ON gl_journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION gl_assert_journal_complete();--> statement-breakpoint

-- ---- Trigger B: a journal must be filled in its own transaction ---------------------------------
-- Trigger A fires on LINES, so it never sees a journal that received none — and an empty journal both
-- sums to zero and would sit there holding an idempotency key, waiting to be filled later. Checking
-- from the JOURNAL side closes that: by its own COMMIT, a journal must already carry exactly the lines
-- it declared.
DROP TRIGGER IF EXISTS trg_gl_journal_filled ON gl_journals;--> statement-breakpoint
CREATE OR REPLACE FUNCTION gl_assert_journal_filled() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  actual_lines int;
BEGIN
  SELECT COUNT(*) INTO actual_lines FROM gl_journal_lines l WHERE l.journal_id = NEW.id;
  IF actual_lines <> NEW.line_count THEN
    RAISE EXCEPTION 'gl journal % committed with % line(s) but declares %; a journal must be posted complete in one transaction',
      NEW.id, actual_lines, NEW.line_count USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_gl_journal_filled
  AFTER INSERT ON gl_journals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION gl_assert_journal_filled();--> statement-breakpoint

-- ---- Triggers C/D: posted history is immutable, for EVERY role ----------------------------------
-- Including the table owner. In production the owner (app_migrator) is non-superuser, so this is a
-- hard guarantee rather than a convention: a correction is a REVERSAL journal (ADR-0013 #9), and
-- there is no other way. Row triggers do not see TRUNCATE, so that gets its own statement trigger.
CREATE OR REPLACE FUNCTION gl_reject_history_rewrite() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'general ledger history is append-only: % on % is never permitted (correct with a reversal journal)',
    TG_OP, TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_gl_journals_immutable ON gl_journals;--> statement-breakpoint
CREATE TRIGGER trg_gl_journals_immutable
  BEFORE UPDATE OR DELETE ON gl_journals
  FOR EACH ROW EXECUTE FUNCTION gl_reject_history_rewrite();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_gl_journal_lines_immutable ON gl_journal_lines;--> statement-breakpoint
CREATE TRIGGER trg_gl_journal_lines_immutable
  BEFORE UPDATE OR DELETE ON gl_journal_lines
  FOR EACH ROW EXECUTE FUNCTION gl_reject_history_rewrite();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_gl_journals_no_truncate ON gl_journals;--> statement-breakpoint
CREATE TRIGGER trg_gl_journals_no_truncate
  BEFORE TRUNCATE ON gl_journals
  FOR EACH STATEMENT EXECUTE FUNCTION gl_reject_history_rewrite();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_gl_journal_lines_no_truncate ON gl_journal_lines;--> statement-breakpoint
CREATE TRIGGER trg_gl_journal_lines_no_truncate
  BEFORE TRUNCATE ON gl_journal_lines
  FOR EACH STATEMENT EXECUTE FUNCTION gl_reject_history_rewrite();--> statement-breakpoint

-- ---- Privileges --------------------------------------------------------------------------------
-- THE BOUNDARY (ADR-0013 #2). The corporate general ledger is company data: it consolidates every
-- tenant, so the tenant-facing role must not reach it at all — a single readable row here would
-- disclose aggregate company revenue across customers.
--
-- The REVOKE is load-bearing, not belt-and-braces: ALTER DEFAULT PRIVILEGES grants app_runtime DML
-- on every newly created table, so without this the tables above arrive readable to the
-- tenant-facing role. There is no RLS policy to fall back on here, because these tables are
-- deliberately not tenant-scoped.
--
-- Unlike the immutability guarantee above, THIS one does depend on grants surviving. `db:assert`
-- re-checks it on every deploy (see checkSecurityLayerApplied) precisely because `prepareRoles()`
-- re-grants broadly each time.
REVOKE ALL PRIVILEGES ON
  "gl_accounts", "gl_journals", "gl_journal_lines"
  FROM PUBLIC, app_runtime, app_provisioner;--> statement-breakpoint

-- The control plane posts journals and reads the books. UPDATE/DELETE are not granted; the triggers
-- above make that structural rather than merely ungranted.
GRANT SELECT, INSERT ON "gl_journals", "gl_journal_lines" TO app_provisioner;--> statement-breakpoint

-- The chart of accounts is reference data maintained by migration: readable so a posting can resolve
-- a code, never writable from the application.
GRANT SELECT ON "gl_accounts" TO app_provisioner;--> statement-breakpoint

-- Match the file's revoke-by-default posture: nothing calls these directly (they are trigger-only and
-- SECURITY INVOKER), so PUBLIC has no business holding EXECUTE.
REVOKE EXECUTE ON FUNCTION
  gl_assert_journal_complete(), gl_assert_journal_filled(), gl_reject_history_rewrite()
  FROM PUBLIC;--> statement-breakpoint

-- ---- The chart of accounts (ADR-0013 #4, #6) ---------------------------------------------------
-- Only the accounts Phase 1 posts to. Each later roadmap phase (provider payables, PSP fees, tax,
-- equity/close) adds its own accounts in its own migration; seeding codes with no posting path would
-- be speculation dressed up as a chart of accounts.
--
-- `control_for_kind` nominates this account as the consolidated counterpart of a tenant subledger
-- account kind. That mapping is what the Phase 1 reconciliation compares, and a partial unique index
-- guarantees at most one control account per kind.
--
-- ON CONFLICT DO NOTHING keeps a re-run harmless. It deliberately does NOT converge classification:
-- changing an existing account's type, normal balance, or control mapping restates the books and
-- belongs in its own reviewed migration, never in a silent seed re-apply.
INSERT INTO gl_accounts (code, name, type, normal_balance, control_for_kind, description) VALUES
  ('1100', 'Payment-processor clearing', 'asset', 'debit', 'gateway_clearing',
   'Funds captured by the payment processor and not yet settled to the bank.'),
  ('2100', 'Customer wallet liability', 'liability', 'credit', 'customer',
   'Prepaid customer balances Fabric holds and owes back as service or refund.'),
  ('2110', 'Customer funds reserved', 'liability', 'credit', 'reserved_clearing',
   'Customer funds committed to in-flight sends; still owed until delivery resolves.'),
  ('2200', 'Contract liability - prepaid units', 'liability', 'credit', 'token_deferred_revenue',
   'Consideration received for units not yet delivered. Recognized as units are consumed.'),
  ('4100', 'Channel revenue', 'revenue', 'credit', 'revenue',
   'Revenue recognized on delivered messaging units, by channel dimension.'),
  ('5900', 'Goodwill and write-offs', 'expense', 'debit', 'writeoff',
   'Approved goodwill credits and uncollectible write-offs.')
ON CONFLICT (code) DO NOTHING;
