-- ================================================================================================
-- THE POSTING AIRLOCK — RLS, grants, and the enqueue trigger. ADR-0013 #10, slice 1b.
-- Companion to 0113 (the table). Hand-written: RLS policies, grants and plpgsql are not expressible
-- in the Drizzle DSL.
--
-- The shape of the seam: the tenant path may only ever say "this movement happened". It cannot read
-- the queue, cannot alter a queued row, and cannot post a journal. A worker running as
-- app_provisioner drains the queue and writes the company's books.
-- ================================================================================================

-- ---- Ownership -----------------------------------------------------------------------------------
-- Pin ownership to app_migrator rather than inheriting whoever applied the migration. FORCE RLS binds
-- the table OWNER, and app_migrator is deliberately NON-superuser so that constraint bites in
-- production. Locally `drizzle-kit migrate` connects as the superuser app_owner, which a superuser's
-- blanket RLS bypass then renders toothless — a prod-fidelity gap the security gate rightly reports.
-- Setting it explicitly makes the isolation identical wherever the migration runs.
--
-- No-op in the cloud (cloud-migrate already migrates as app_migrator and REASSIGNs), and idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator')
     AND EXISTS (
       SELECT 1 FROM pg_tables
        WHERE tablename = 'gl_posting_requests' AND tableowner <> 'app_migrator'
     )
  THEN
    ALTER TABLE gl_posting_requests OWNER TO app_migrator;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE gl_posting_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- FORCE so the table OWNER is subject to the policies too, matching every other tenant table.
ALTER TABLE gl_posting_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---- Policies ----------------------------------------------------------------------------------
-- INSERT-ONLY for the tenant-facing role, and the row must belong to the ambient tenant. There is
-- deliberately no USING clause: `FOR INSERT` policies only have WITH CHECK, which is exactly the
-- asymmetry wanted here — write in, never read back.
--
-- `current_setting('app.tenant_id', true)` with missing_ok = true returns NULL rather than raising
-- when the GUC is unset, so a query outside withTenant() fails the policy instead of erroring with a
-- confusing 42704. NULL <> uuid is NULL, which is not TRUE, so the insert is refused. Fails closed.
DROP POLICY IF EXISTS runtime_insert ON gl_posting_requests;--> statement-breakpoint
CREATE POLICY runtime_insert ON gl_posting_requests
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint

-- The drain operates ABOVE tenant scope: it consolidates every tenant into one set of books, so it
-- cannot be tenant-scoped. Mirrors the provisioner_all policies from 0013. RDS forbids BYPASSRLS, so
-- a permissive policy is how a cross-tenant role is expressed here.
DROP POLICY IF EXISTS provisioner_all ON gl_posting_requests;--> statement-breakpoint
CREATE POLICY provisioner_all ON gl_posting_requests
  FOR ALL TO app_provisioner USING (true) WITH CHECK (true);--> statement-breakpoint

-- ---- Grants ------------------------------------------------------------------------------------
-- Least privilege on top of the policies: a policy cannot restrict a privilege the role never had.
-- app_runtime gets INSERT and nothing else — no SELECT, so the queue is write-only from the tenant
-- side even before RLS is considered.
REVOKE ALL PRIVILEGES ON gl_posting_requests FROM PUBLIC, app_runtime, app_provisioner;--> statement-breakpoint
GRANT INSERT ON gl_posting_requests TO app_runtime;--> statement-breakpoint
-- The drain reads pending rows and marks them posted/failed. No DELETE: a drained request is the
-- reconciliation link between a customer movement and its company posting.
GRANT SELECT, INSERT, UPDATE ON gl_posting_requests TO app_provisioner;--> statement-breakpoint

-- ---- The enqueue trigger -----------------------------------------------------------------------
-- DEFERRED, and it has to be: the trigger builds its payload FROM the transaction's legs, and at
-- statement time those legs do not exist yet — `openIdempotentTxn` inserts the envelope first and
-- `postLegs` adds the legs afterwards. Firing at COMMIT is the only point where the movement is
-- complete.
--
-- WHY A TRIGGER AND NOT A CALL IN EACH WALLET PRIMITIVE: a primitive that forgot to enqueue would
-- produce money movement with no counterpart in the company's books, and nothing would fail. This
-- cannot be forgotten by a future primitive, and it is inside the movement's own transaction by
-- construction — so a crash after the movement but before the enqueue is impossible.
--
-- SKIPPING LEGLESS TRANSACTIONS: a txn envelope with fewer than two legs moved no money, so there is
-- nothing to post and no request is written. In production every committed movement has its legs
-- (postLegs runs in the same transaction, so a failure rolls the envelope back too); this guard
-- exists because tests legitimately insert bare envelopes, and fabricating a request for one would
-- put an unpostable row in the queue.
--
-- Amounts are written as JSON STRINGS (`::text`), never numbers: jsonb numbers are IEEE-754 doubles
-- and would silently round a large minor-unit amount. Money is never a float here.
CREATE OR REPLACE FUNCTION gl_enqueue_posting_request() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  leg_payload jsonb;
  leg_currency char(3);
  currency_count int;
  movement_channel text;
BEGIN
  SELECT jsonb_agg(
           jsonb_build_object(
             'account_kind', a.kind::text,
             'direction', e.direction::text,
             'amount_minor', e.amount_minor::text
           ) ORDER BY e.id
         ),
         min(a.currency),
         count(DISTINCT a.currency)
    INTO leg_payload, leg_currency, currency_count
    FROM ledger_entries e
    JOIN ledger_accounts a ON a.id = e.account_id
   WHERE e.txn_id = NEW.id;

  IF leg_payload IS NULL OR jsonb_array_length(leg_payload) < 2 THEN
    RETURN NULL;
  END IF;

  -- A journal carries ONE currency column, so a multi-currency movement cannot be represented and
  -- min() would silently book one currency's amounts under another. 0007's trg_ledger_txn_balanced
  -- already rejects a multi-currency transaction, so this is unreachable today — but relying on an
  -- invariant enforced in a different migration, with a silent wrong answer as the failure mode, is
  -- not a trade worth making. Assert it here where min() is used.
  IF currency_count <> 1 THEN
    RAISE EXCEPTION 'ledger transaction % spans % currencies; a GL posting request must be single-currency',
      NEW.id, currency_count USING ERRCODE = 'check_violation';
  END IF;

  -- The channel dimension, if the movement carries one.
  --
  -- BE CLEAR THAT THIS IS NULL TODAY: `ledger_transactions.metadata` holds the idempotency
  -- FINGERPRINT, and no wallet primitive writes a channel into it. (Its keys vary by primitive —
  -- credit/reserve store {op, currency, amount, ref}, commit/refund store {op, ref}, and maker-checker
  -- adjustments store {reason_code, contra_kind} — so do not assume a fixed key set here.) This
  -- therefore reads NULL in practice and `gl_journal_lines.channel` is unpopulated for now.
  --
  -- That is deliberate: the alternative is guessing from the ledger reason, and `message_reserve` is
  -- channel-neutral (it backs both SMS and email), so a guess would attribute email revenue to SMS.
  --
  -- Populating it is follow-up work, and it must NOT be done by widening the fingerprint: the
  -- fingerprint is compared on replay, so adding a key turns a retried in-flight movement across the
  -- deploy boundary into an IdempotencyConflictError instead of a clean replay. The channel needs to
  -- reach the ledger as its own column or via the reference, not through the dedupe key.
  movement_channel := NEW.metadata->>'channel';

  -- NO `ON CONFLICT DO NOTHING` here, deliberately. It would require SELECT privilege on this table
  -- (Postgres must read the conflicting row to infer the arbiter index), and granting app_runtime
  -- SELECT would turn the write-only airlock into a readable queue — giving up the seam for a clause
  -- that protects against nothing: a constraint trigger fires exactly once per inserted row, and
  -- `ledger_txn_id` is UNIQUE, so there is no path to a conflict. If one ever did occur it means an
  -- assumption broke, and for money a loud failure beats a silent skip.
  INSERT INTO gl_posting_requests
    (tenant_id, ledger_txn_id, currency, event_time, channel, legs)
  VALUES
    (NEW.tenant_id, NEW.id, leg_currency, NEW.created_at, movement_channel, leg_payload);

  RETURN NULL;
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_gl_enqueue_posting_request ON ledger_transactions;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_gl_enqueue_posting_request
  AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION gl_enqueue_posting_request();--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION gl_enqueue_posting_request() FROM PUBLIC;
