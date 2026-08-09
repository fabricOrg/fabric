import type postgres from "postgres";

/**
 * Refuse to run a spec that TRUNCATES shared tenant tables when the database holds real data.
 *
 * Several isolation specs need a clean global picture — they assert things like "tenant A cannot see
 * tenant B's rows", which is only meaningful if A and B are the only tenants. So they run
 * `DELETE FROM accounts` / `applications` / `environments` with no WHERE. That is correct on an
 * ephemeral CI database and destructive on a developer's, where the same tables hold a seeded
 * workspace and whatever an operator armed.
 *
 * On 2026-08-09 this was not hypothetical twice over: a live WhatsApp foreign key is the only reason a
 * pilot tenant survived one of these runs (the spec failed instead of the data disappearing), and a
 * sibling guard's missing teardown check had already destroyed a live Meta credential the same day.
 *
 * The signal is an account the spec did not create. Fixture tenants are passed in; anything else means
 * someone is using this database for real, and a spec that wipes every account has no business running
 * against it. Failing loudly turns "your workspace is gone" into "point this at a scratch database".
 *
 * Skipped when `CI` is set — the database there is created and thrown away for the run, so there is
 * nothing to protect and refusing would only break the suite the guard exists to keep honest. That
 * asymmetry is deliberate; it is the same lesson a sibling guard learned by breaking CI first.
 *
 * `ALLOW_DESTRUCTIVE_DB_TESTS=1` is the explicit local override, for a scratch database a developer
 * genuinely means to wipe. It has to be typed out, which is the point.
 */
export async function assertDisposableDatabase(
  owner: postgres.Sql,
  input: { fixtureTenantIds: readonly string[]; spec: string },
): Promise<void> {
  if (process.env.CI || process.env.ALLOW_DESTRUCTIVE_DB_TESTS === "1") return;

  const foreign = (await owner`
    SELECT id, name
    FROM accounts
    WHERE id <> ALL(${owner.array([...input.fixtureTenantIds])}::uuid[])
    ORDER BY name
    LIMIT 10`) as Array<{ id: string; name: string }>;
  if (foreign.length === 0) return;

  const named = foreign.map((row) => `${row.name} (${row.id})`).join(", ");
  throw new Error(
    `refusing to wipe shared tenant tables: ${input.spec} deletes every row from accounts / applications / environments, and this database holds ${foreign.length} account(s) it did not create — ${named}. ` +
      "Point DATABASE_URL_SUPER at a scratch database, or set ALLOW_DESTRUCTIVE_DB_TESTS=1 if this data is genuinely disposable.",
  );
}
