/**
 * One-off backfill (ADR-0004): give every EXISTING workspace the new hierarchy that new signups get
 * at provision time — a default application, a sandbox environment, and a live environment.
 *
 * WHY THIS EXISTS: the flat world had no `applications`/`environments` rows; "sandbox vs live" was a
 * `plan` flag on the account. After ADR-0004, scoped resources (api_keys, webhooks, logs) hang off an
 * environment. Existing accounts need their default app + environments created so the re-key backfill
 * (#6) has something to point at. New accounts get these from the converged provisioning path.
 *
 * live environment status: `active` iff the account is already live today (`plan <> 'sandbox'`),
 * otherwise `locked` — go-live is what unlocks it (compliance gate, ADR-0002). The sandbox env is
 * always `active`.
 *
 * RE-RUNNABLE: idempotent on (tenant_id, slug) for the app and (application_id, type) for each env —
 * an interrupted run resumes safely and a second run is a no-op.
 *
 * WHERE IT RUNS + WHICH ROLE: FORCE RLS subjects even the table owner to policies and no role has
 * BYPASSRLS (RDS forbids it), so cross-tenant enumeration/writes go through `app_provisioner`, whose
 * `provisioner_all` policies (0013 on accounts, 0046 on applications/environments) let exactly that
 * role operate above tenant scope. The deployed DB is not publicly reachable, so this ships inside the
 * api image (like cloud-migrate/cloud-seed) and runs as an in-VPC ECS task.
 *   local:  DATABASE_URL_SUPER=… pnpm tsx packages/db/src/cloud-backfill-app-env.ts [--commit]
 *   cloud:  aws ecs run-task … command ["node","node_modules/@app/db/dist/cloud-backfill-app-env.js",
 *             "--commit"]   (task def injects DATABASE_URL_PROVISIONER)
 *
 * Defaults to a DRY RUN: reports what it would create and changes nothing. Pass --commit to write.
 */
import postgres from "postgres";

// Cross-tenant role in cloud (app_provisioner, permissive provisioner_all). Locally app_provisioner
// is a NOLOGIN placeholder, so local runs use the superuser (app_owner = DATABASE_URL_SUPER).
const databaseUrl =
  process.env.DATABASE_URL_PROVISIONER ?? process.env.DATABASE_URL_SUPER;
const commit = process.argv.includes("--commit");

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL_PROVISIONER (cloud) or DATABASE_URL_SUPER (local) is required.",
  );
}

async function main(url: string) {
  const sql = postgres(url, { max: 1 });
  let created = 0;
  let alreadyHad = 0;
  const failures: string[] = [];
  try {
    const accounts = await sql<Array<{ id: string; plan: string }>>`
      SELECT id, plan FROM accounts ORDER BY created_at`;

    console.log(
      `${accounts.length} workspaces to backfill${commit ? "" : " (DRY RUN — nothing will be written)"}`,
    );

    for (const acct of accounts) {
      try {
        // Reporting only: did the default app already exist before this run? (The writes below are
        // all idempotent, so we run them every time regardless — this just labels created vs no-op.)
        const [existing] = await sql<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM applications
          WHERE tenant_id = ${acct.id} AND slug = 'default'`;
        const isNew = !existing || existing.n === 0;

        const liveStatus = acct.plan === "sandbox" ? "locked" : "active";
        if (!commit) {
          console.log(
            isNew
              ? `  would create default app + sandbox(active) + live(${liveStatus}) for ${acct.id}, and point its keys/webhooks at it`
              : `  would re-point any unassigned keys/webhooks for ${acct.id}`,
          );
          if (isNew) created += 1;
          else alreadyHad += 1;
          continue;
        }

        await sql.begin(async (tx) => {
          const [app] = await tx<Array<{ id: string }>>`
            INSERT INTO applications (tenant_id, name, slug)
            VALUES (${acct.id}, 'Default', 'default')
            ON CONFLICT (tenant_id, slug) DO UPDATE SET slug = EXCLUDED.slug
            RETURNING id`;
          if (!app) throw new Error("application upsert returned no row");
          // sandbox is always active; live is active iff already live today, else locked until go-live.
          await tx`
            INSERT INTO environments (tenant_id, application_id, type, status)
            VALUES
              (${acct.id}, ${app.id}, 'sandbox', 'active'),
              (${acct.id}, ${app.id}, 'live', ${liveStatus})
            ON CONFLICT (application_id, type) DO NOTHING`;

          const envs = await tx<Array<{ id: string; type: string }>>`
            SELECT id, type FROM environments WHERE application_id = ${app.id}`;
          const sandboxEnv = envs.find((e) => e.type === "sandbox")?.id;
          const liveEnv = envs.find((e) => e.type === "live")?.id;
          if (!sandboxEnv || !liveEnv) {
            throw new Error("expected both sandbox and live environments");
          }

          // Point existing keys at the env matching their prefix: sk_test_ -> sandbox, sk_live_ ->
          // live. Only rows not yet assigned (idempotent). New keys set this at mint time (#6b).
          await tx`
            UPDATE api_keys SET application_id = ${app.id},
              environment_id = CASE WHEN env = 'test' THEN ${sandboxEnv}::uuid ELSE ${liveEnv}::uuid END
            WHERE tenant_id = ${acct.id} AND application_id IS NULL`;

          // Existing webhook endpoints predate the env split — point them at the environment matching
          // the account's current liveness (a live account's endpoints are for live traffic).
          const webhookEnv = liveStatus === "active" ? liveEnv : sandboxEnv;
          await tx`
            UPDATE webhook_endpoints SET application_id = ${app.id}, environment_id = ${webhookEnv}
            WHERE tenant_id = ${acct.id} AND application_id IS NULL`;
        });
        if (isNew) created += 1;
        else alreadyHad += 1;
      } catch (error) {
        failures.push(
          `${acct.id}: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    console.log(
      `\ncreated: ${created}   already had: ${alreadyHad}   failed: ${failures.length}`,
    );
    if (failures.length > 0) {
      console.log("failures (left untouched, safe to re-run):");
      for (const line of failures) console.log(`  ${line}`);
    }
    if (!commit && created > 0) {
      console.log("\nDry run. Re-run with --commit to write.");
    }
  } finally {
    await sql.end();
  }
}

await main(databaseUrl);
