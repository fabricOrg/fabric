import type { Sql } from "postgres";

/**
 * `prepareRoles` deliberately grants broad DML so a newly created table is usable during migration.
 * Journaled REVOKE migrations run only once, so every deploy must restore the narrower steady-state
 * posture after migrations or the second deploy silently reopens immutable financial history.
 */
export async function enforceRestrictedPrivileges(sql: Sql): Promise<void> {
  await sql.unsafe(`
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON gl_accounts FROM app_provisioner;
    GRANT SELECT ON gl_accounts TO app_provisioner;
    REVOKE UPDATE, DELETE, TRUNCATE
      ON gl_journals, gl_journal_lines FROM app_provisioner;
    GRANT SELECT, INSERT ON gl_journals, gl_journal_lines TO app_provisioner;

    REVOKE DELETE, TRUNCATE ON gl_posting_requests FROM app_provisioner;
    GRANT SELECT, UPDATE ON gl_posting_requests TO app_provisioner;

    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
      ON sandbox_usage_buckets, sandbox_usage_events
      FROM app_provisioner;
    GRANT SELECT ON sandbox_usage_buckets, sandbox_usage_events TO app_provisioner;

    REVOKE UPDATE, DELETE, TRUNCATE
      ON token_recognition_allocations
      FROM app_runtime, app_provisioner;
    REVOKE INSERT ON token_recognition_allocations FROM app_provisioner;
    GRANT SELECT, INSERT ON token_recognition_allocations TO app_runtime;
    GRANT SELECT ON token_recognition_allocations TO app_provisioner;

    REVOKE DELETE, TRUNCATE
      ON token_lots, token_holds, token_counters
      FROM app_runtime, app_provisioner;
    REVOKE DELETE, TRUNCATE ON token_purchases FROM app_provisioner;
  `);
}
