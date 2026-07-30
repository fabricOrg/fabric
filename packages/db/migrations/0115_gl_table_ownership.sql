-- ================================================================================================
-- PIN OWNERSHIP OF THE CORPORATE BOOKS to app_migrator, the same way 0114 does for the posting
-- airlock. ADR-0013.
--
-- WHY: `drizzle-kit migrate` creates tables owned by whatever role `DATABASE_URL_OWNER` names. In the
-- cloud that is the non-superuser app_migrator (and cloud-migrate REASSIGNs besides), but locally it is
-- the superuser app_owner — so the same schema ends up with different owners in the two places.
--
-- That divergence is not cosmetic. Ownership decides who a privilege check exempts and whether FORCE
-- RLS binds, so a check that passes locally can behave differently deployed. 0114 hit exactly this for
-- gl_posting_requests; these three were left behind because no gate covered them, which is precisely
-- the kind of gap that stays open until something depends on it.
--
-- Idempotent, and a no-op in the cloud where ownership is already correct.
-- ================================================================================================

DO $$
DECLARE
  target text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    RETURN;
  END IF;
  FOREACH target IN ARRAY ARRAY['gl_accounts', 'gl_journals', 'gl_journal_lines']
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables WHERE tablename = target AND tableowner <> 'app_migrator'
    ) THEN
      EXECUTE format('ALTER TABLE %I OWNER TO app_migrator', target);
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- Ownership does not carry privileges, and 0112's grants were made to app_provisioner by the previous
-- owner; restate them so the control plane keeps exactly the access it had. Append-only stands: no
-- UPDATE, no DELETE, and the immutability triggers do not depend on grants anyway.
GRANT SELECT, INSERT ON "gl_journals", "gl_journal_lines" TO app_provisioner;--> statement-breakpoint
GRANT SELECT ON "gl_accounts" TO app_provisioner;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "gl_accounts", "gl_journals", "gl_journal_lines"
  FROM PUBLIC, app_runtime;
